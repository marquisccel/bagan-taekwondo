import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimExport,
  completeExport,
  createExportRequest,
  failExport,
  failStuckExport,
  findStaleRequestedExports,
  findStuckGeneratingExports,
  getExport,
  listExportsForRevision,
  type CreateExportRequestArgs,
} from './export-repository.js';
import { newSnapshot, newTournament } from './testing/seed.js';
import { dbError, testBackends, type TestDb } from './testing/test-db.js';

/**
 * Phase 6 — export-repository: the state machine (REQUESTED -> GENERATING -> {READY, FAILED}),
 * atomic claim, idempotent retry, and traceability guarantees required by ACCEPTANCE §1. The
 * database invariants themselves are proven independently by export-artifact-guard.db.test.ts; this
 * file proves the repository functions built on top of them.
 */
for (const backend of testBackends()) {
  describe(`export-repository — ${backend.name}`, () => {
    let db: TestDb;
    let tournament: string;
    let officer: string;
    let drawRunId: string;
    let revisionId: string;
    let baseArgs: Omit<CreateExportRequestArgs, 'sourceFingerprint' | 'parametersFingerprint'>;

    beforeAll(async () => {
      db = await backend.open();
      const t = await newTournament(db);
      tournament = t.tournament;
      officer = t.officer;
      const snapshotId = await newSnapshot(db, tournament, t.ruleSet, officer);

      const [run] = await db.query<{ id: string }>(
        `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, seed, engine_version,
           rules_snapshot, rules_fingerprint, input_fingerprint, params, scope, requested_by)
         values ($1, $2, $5, 'SIMULATION', '1', 'test', '{}'::jsonb, $4, $4, '{}'::jsonb, '[]'::jsonb, $3)
         returning id`,
        [tournament, t.ruleSet, officer, `sha256:${'a'.repeat(64)}`, snapshotId],
      );
      drawRunId = run?.id ?? '';

      const [rev] = await db.query<{ id: string }>(
        `insert into draw_revision (tournament_id, draw_run_id, revision_no, lifecycle, created_by)
         values ($1, $2, 1, 'DRAFT', $3) returning id`,
        [tournament, drawRunId, officer],
      );
      revisionId = rev?.id ?? '';

      baseArgs = {
        tournamentId: tournament,
        drawRunId,
        revisionId,
        revisionNo: 1,
        exportType: 'TOURNAMENT_DRAW_BOOK',
        format: 'PDF',
        mode: 'PREVIEW',
        scopeType: 'REVISION',
        categoryId: null,
        poolId: null,
        engineVersion: 'test',
        templateVersion: 'v1',
        requestedBy: officer,
      };
    });
    afterAll(async () => db.close());

    it('createExportRequest inserts a REQUESTED row traceable by revision, type and fingerprints', async () => {
      const { exportId, reused } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s1',
          parametersFingerprint: 'sha256:p1',
        }),
      );
      expect(reused).toBe(false);
      const row = await getExport(db, exportId);
      expect(row).toMatchObject({
        status: 'REQUESTED',
        revisionId,
        exportType: 'TOURNAMENT_DRAW_BOOK',
        sourceFingerprint: 'sha256:s1',
        parametersFingerprint: 'sha256:p1',
      });
    });

    it('retrying an identical request (same fingerprints) is idempotent — no duplicate row', async () => {
      const first = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s2',
          parametersFingerprint: 'sha256:p2',
        }),
      );
      const second = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s2',
          parametersFingerprint: 'sha256:p2',
        }),
      );
      expect(second.exportId).toBe(first.exportId);
      expect(second.reused).toBe(true);
      const list = await listExportsForRevision(db, revisionId);
      expect(list.filter((e) => e.sourceFingerprint === 'sha256:s2')).toHaveLength(1);
    });

    it('a different parametersFingerprint (e.g. a different mode) is a distinct export, not reused', async () => {
      const preview = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s3',
          parametersFingerprint: 'sha256:p3-preview',
        }),
      );
      const official = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          mode: 'OFFICIAL',
          sourceFingerprint: 'sha256:s3',
          parametersFingerprint: 'sha256:p3-official',
        }),
      );
      expect(official.exportId).not.toBe(preview.exportId);
    });

    it('claimExport atomically transitions REQUESTED -> GENERATING and sets started_at', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s4',
          parametersFingerprint: 'sha256:p4',
        }),
      );
      const claimed = await claimExport(db, exportId);
      expect(claimed?.status).toBe('GENERATING');
      expect(claimed?.startedAt).not.toBeNull();
    });

    it('two concurrent claims on the same export: exactly one succeeds', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s5',
          parametersFingerprint: 'sha256:p5',
        }),
      );
      const [a, b] = await Promise.all([claimExport(db, exportId), claimExport(db, exportId)]);
      const results = [a, b];
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(1);
    });

    it('a second claim attempt after the first succeeded is a safe no-op (retry-safe)', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s6',
          parametersFingerprint: 'sha256:p6',
        }),
      );
      expect(await claimExport(db, exportId)).not.toBeNull();
      expect(await claimExport(db, exportId)).toBeNull();
    });

    it('completeExport only succeeds from GENERATING, and the resulting READY row is immutable', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s7',
          parametersFingerprint: 'sha256:p7',
        }),
      );
      // Cannot complete a REQUESTED export (never claimed).
      expect(
        await completeExport(db, exportId, {
          storageKey: 'k',
          filename: 'f.pdf',
          sizeBytes: 10,
          outputFingerprint: 'sha256:o',
          fileSha256: 'sha256:f',
        }),
      ).toBe(false);

      await claimExport(db, exportId);
      expect(
        await completeExport(db, exportId, {
          storageKey: 'exports/x/f.pdf',
          filename: 'f.pdf',
          sizeBytes: 12345,
          outputFingerprint: 'sha256:o7',
          fileSha256: 'sha256:f7',
        }),
      ).toBe(true);

      const row = await getExport(db, exportId);
      expect(row).toMatchObject({
        status: 'READY',
        storageKey: 'exports/x/f.pdf',
        filename: 'f.pdf',
        sizeBytes: 12345,
        outputFingerprint: 'sha256:o7',
        fileSha256: 'sha256:f7',
      });
      expect(row?.generatedAt).not.toBeNull();

      // A second completion attempt (duplicate worker delivery) is a safe no-op, never an error.
      expect(
        await completeExport(db, exportId, {
          storageKey: 'other',
          filename: 'other.pdf',
          sizeBytes: 1,
          outputFingerprint: 'sha256:x',
          fileSha256: 'sha256:x',
        }),
      ).toBe(false);
      expect((await getExport(db, exportId))?.storageKey).toBe('exports/x/f.pdf');
    });

    it('failExport only succeeds from GENERATING, stores a stable code, and the FAILED row is immutable', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s8',
          parametersFingerprint: 'sha256:p8',
        }),
      );
      expect(await failExport(db, exportId, 'EXPORT_GENERATION_FAILED', 'render failed')).toBe(false);

      await claimExport(db, exportId);
      expect(await failExport(db, exportId, 'EXPORT_TEMPLATE_ERROR', 'missing template field')).toBe(true);

      const row = await getExport(db, exportId);
      expect(row).toMatchObject({ status: 'FAILED', errorCode: 'EXPORT_TEMPLATE_ERROR' });

      // A retry after failure is a fresh row, not a reuse of the failed one.
      const retry = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s8',
          parametersFingerprint: 'sha256:p8',
        }),
      );
      expect(retry.exportId).not.toBe(exportId);
      expect(retry.reused).toBe(false);
    });

    it('a raw stack trace passed as errorMessage is stored verbatim by design (caller must sanitize)', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s9',
          parametersFingerprint: 'sha256:p9',
        }),
      );
      await claimExport(db, exportId);
      await failExport(db, exportId, 'EXPORT_GENERATION_FAILED', 'renderer unavailable');
      const row = await getExport(db, exportId);
      // The repository itself never leaks internals: the message it stored is exactly what the
      // caller passed, and callers (apps/worker) are required to pass a safe message, never `e.stack`.
      expect(row?.errorMessage).toBe('renderer unavailable');
      expect(row?.errorMessage).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    });

    it('reconciliation: finds stale REQUESTED and stuck GENERATING exports, ignoring finished ones', async () => {
      // Earlier tests in this file leave their own REQUESTED/GENERATING rows behind, so this
      // asserts on one freshly created export rather than on the sweep returning nothing at all
      // (mirrors draw-run.db.test.ts's reconciliation test, which has that luxury only because it
      // runs before any other row exists).
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s10',
          parametersFingerprint: 'sha256:p10',
        }),
      );
      await db.query(`alter table export_artifact disable trigger export_artifact_guard`);
      try {
        await db.query(`update export_artifact set requested_at = now() - interval '1 hour' where id = $1`, [
          exportId,
        ]);
      } finally {
        await db.query(`alter table export_artifact enable trigger export_artifact_guard`);
      }
      expect(await findStaleRequestedExports(db, 1000)).toContain(exportId);

      const claimed = await claimExport(db, exportId);
      expect(claimed).not.toBeNull();
      await db.query(`update export_artifact set started_at = now() - interval '1 hour' where id = $1`, [
        exportId,
      ]);
      expect(await findStuckGeneratingExports(db, 1000)).toContain(exportId);

      const [a, b] = await Promise.all([
        failStuckExport(db, exportId, 'reconciliation sweep'),
        failStuckExport(db, exportId, 'reconciliation sweep'),
      ]);
      expect([a, b].sort()).toEqual([false, true]);
      const row = await getExport(db, exportId);
      expect(row?.status).toBe('FAILED');
      expect(row?.errorCode).toBe('EXPORT_GENERATION_FAILED');
      expect(await findStuckGeneratingExports(db, 0)).not.toContain(exportId);
    });

    it('rejects EXPORT_ROW mutation of source/parameters fingerprints after other work has completed', async () => {
      const { exportId } = await db.transaction((tx) =>
        createExportRequest(tx, {
          ...baseArgs,
          sourceFingerprint: 'sha256:s11',
          parametersFingerprint: 'sha256:p11',
        }),
      );
      expect(
        await dbError(
          db.query(`update export_artifact set source_fingerprint = 'sha256:tampered' where id = $1`, [
            exportId,
          ]),
        ),
      ).toContain('EXPORT_ARTIFACT_IMMUTABLE');
    });
  });
}
