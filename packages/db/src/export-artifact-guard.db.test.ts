import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newSnapshot, newTournament } from './testing/seed.js';
import { dbError, testBackends, type TestDb } from './testing/test-db.js';

/**
 * Phase 6 — export_artifact_guard (0006): forbids DELETE, freezes the request-identity fields for
 * the row's lifetime, and enforces REQUESTED -> GENERATING -> {READY, FAILED} only. Exercised
 * directly against the database, independent of the (not-yet-written) export-repository layer, the
 * same way draw-run.db.test.ts proves draw_run_guard.
 */
for (const backend of testBackends()) {
  describe(`export_artifact_guard — ${backend.name}`, () => {
    let db: TestDb;
    let tournament: string;
    let officer: string;
    let drawRunId: string;
    let revisionId: string;

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
    });
    afterAll(async () => db.close());

    const insertRequested = () =>
      db.query<{ id: string }>(
        `insert into export_artifact (tournament_id, draw_run_id, revision_id, revision_no, export_type, format, mode,
           scope_type, source_fingerprint, parameters_fingerprint, engine_version, template_version, requested_by)
         values ($1, $2, $3, 1, 'TOURNAMENT_DRAW_BOOK', 'PDF', 'PREVIEW', 'REVISION', 'sha256:s', 'sha256:p', 'test', 'v1', $4)
         returning id`,
        [tournament, drawRunId, revisionId, officer],
      );

    it('creates a REQUESTED row for a REVISION-scoped export', async () => {
      const [row] = await insertRequested();
      expect(row?.id).toBeTruthy();
    });

    it('rejects a direct REQUESTED -> READY jump', async () => {
      const [row] = await insertRequested();
      expect(
        await dbError(db.query(`update export_artifact set status = 'READY' where id = $1`, [row?.id])),
      ).toContain('INVALID_EXPORT_TRANSITION');
    });

    it('rejects marking READY without storage/fingerprint fields (export_artifact_ready_ck)', async () => {
      const [row] = await insertRequested();
      await db.query(`update export_artifact set status = 'GENERATING' where id = $1`, [row?.id]);
      expect(
        await dbError(db.query(`update export_artifact set status = 'READY' where id = $1`, [row?.id])),
      ).toContain('export_artifact_ready_ck');
    });

    it('rejects marking FAILED without an error_code (export_artifact_failed_ck)', async () => {
      const [row] = await insertRequested();
      await db.query(`update export_artifact set status = 'GENERATING' where id = $1`, [row?.id]);
      expect(
        await dbError(db.query(`update export_artifact set status = 'FAILED' where id = $1`, [row?.id])),
      ).toContain('export_artifact_failed_ck');
    });

    it('allows the full REQUESTED -> GENERATING -> READY path with the required fields present', async () => {
      const [row] = await insertRequested();
      await db.query(`update export_artifact set status = 'GENERATING' where id = $1`, [row?.id]);
      await db.query(
        `update export_artifact set status = 'READY', storage_key = 'k', filename = 'f.pdf', size_bytes = 1,
           output_fingerprint = 'sha256:z', file_sha256 = 'sha256:f', generated_at = now() where id = $1`,
        [row?.id],
      );
      const [after] = await db.query<{ status: string }>(`select status from export_artifact where id = $1`, [
        row?.id,
      ]);
      expect(after?.status).toBe('READY');
    });

    it('a finished export is immutable and never deleted', async () => {
      const [row] = await insertRequested();
      await db.query(`update export_artifact set status = 'GENERATING' where id = $1`, [row?.id]);
      await db.query(
        `update export_artifact set status = 'FAILED', error_code = 'EXPORT_GENERATION_FAILED' where id = $1`,
        [row?.id],
      );
      expect(
        await dbError(db.query(`update export_artifact set status = 'GENERATING' where id = $1`, [row?.id])),
      ).toContain('EXPORT_ARTIFACT_IMMUTABLE');
      expect(await dbError(db.query(`delete from export_artifact where id = $1`, [row?.id]))).toContain(
        'EXPORT_ARTIFACT_IMMUTABLE',
      );
    });

    it('freezes identity fields once set', async () => {
      const [row] = await insertRequested();
      expect(
        await dbError(
          db.query(`update export_artifact set engine_version = 'other' where id = $1`, [row?.id]),
        ),
      ).toContain('EXPORT_ARTIFACT_IMMUTABLE');
      expect(
        await dbError(
          db.query(`update export_artifact set source_fingerprint = 'sha256:other' where id = $1`, [row?.id]),
        ),
      ).toContain('EXPORT_ARTIFACT_IMMUTABLE');
      expect(
        await dbError(
          db.query(`update export_artifact set parameters_fingerprint = 'sha256:other' where id = $1`, [
            row?.id,
          ]),
        ),
      ).toContain('EXPORT_ARTIFACT_IMMUTABLE');
    });

    it('rejects inconsistent scope (category_id set while scope_type is REVISION)', async () => {
      expect(
        await dbError(
          db.query(
            `insert into export_artifact (tournament_id, draw_run_id, revision_id, revision_no, export_type, format, mode,
               scope_type, category_id, source_fingerprint, parameters_fingerprint, engine_version, template_version, requested_by)
             values ($1, $2, $3, 1, 'CATEGORY_DRAW', 'PDF', 'PREVIEW', 'REVISION', gen_random_uuid(), 'sha256:s', 'sha256:p', 'test', 'v1', $4)`,
            [tournament, drawRunId, revisionId, officer],
          ),
        ),
      ).toContain('export_artifact_scope_ck');
    });
  });
}
