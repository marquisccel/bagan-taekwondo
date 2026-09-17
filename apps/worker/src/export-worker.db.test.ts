import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDrawRun,
  createExportRequest,
  executeDrawRun,
  getExport,
  MIGRATIONS_FOLDER,
  persistIntake,
  persistRuleSet,
  type Db,
  poolDb,
} from '@bagantkd/db';
import { newArena, newTournament, TEST_NIK_KEYS } from '@bagantkd/db/testing/seed';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { localArtifactStorage } from '@bagantkd/export';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPORT_QUEUE } from './export-worker.js';
import { startWorker, type WorkerHandle } from './main.js';

/** Same throwaway-database convention as worker.db.test.ts (pg-boss needs real Postgres). */
const adminUrl = process.env['DATABASE_URL'];

async function createThrowawayDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const dbName = `bagantkd_export_worker_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const parsed = new URL(adminUrl as string);
  parsed.pathname = `/${dbName}`;
  const url = parsed.toString();
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  await pool.end();
  return {
    url,
    async drop() {
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${dbName} with (force)`);
      await cleanup.end();
    },
  };
}

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe.skipIf(!adminUrl)('export worker (pg-boss + reconciliation) — postgres', () => {
  let db: Db;
  let pool: pg.Pool;
  let url: string;
  let dropDb: () => Promise<void>;
  let storageDir: string;
  let tournament: string;
  let officer: string;
  let td: string;
  let revisionId: string;
  let drawRunId: string;

  beforeAll(async () => {
    const throwaway = await createThrowawayDatabase();
    url = throwaway.url;
    dropDb = throwaway.drop;
    storageDir = await mkdtemp(join(tmpdir(), 'bagantkd-export-worker-'));
    pool = new pg.Pool({ connectionString: url, max: 5 });
    db = poolDb(pool);
    const t = await newTournament(db);
    tournament = t.tournament;
    officer = t.officer;
    td = t.td;
    await newArena(db, tournament);
    const persisted = await db.transaction((tx) =>
      persistRuleSet(tx, { tournamentId: tournament, actorId: officer, ruleSet }),
    );
    const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet });
    if (!intake.snapshot) throw new Error('no snapshot');
    const saved = await db.transaction((tx) =>
      persistIntake(tx, {
        tournamentId: tournament,
        ruleSetId: persisted.ruleSetId,
        actorId: officer,
        result: intake,
        nikKeys: TEST_NIK_KEYS,
        mode: 'INITIAL',
      }),
    );
    const plan = runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'CANDIDATE',
      seed: parseDrawSeed('20260827'),
      ruleSet,
      entries: intake.snapshot.entries,
      scope: [],
      assumptions: null,
    });
    const scope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
    const created = await db.transaction((tx) =>
      createDrawRun(tx, {
        tournamentId: tournament,
        ruleSetId: persisted.ruleSetId,
        ruleSetSnapshot: ruleSet,
        ruleSetFingerprint: plan.fingerprints.rules,
        intakeSnapshotId: saved.snapshotId,
        intakeEntries: intake.snapshot?.entries ?? [],
        kind: 'CANDIDATE',
        seed: '20260827',
        scope,
        assumptions: null,
        requestedBy: officer,
      }),
    );
    drawRunId = created.drawRunId;
    await executeDrawRun(db, drawRunId);
    const [revision] = await db.query<{ id: string }>(`select id from draw_revision where draw_run_id = $1`, [
      drawRunId,
    ]);
    revisionId = revision?.id ?? '';
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await dropDb();
  });

  it('request -> worker generates -> READY -> the file is actually on disk and matches file_sha256', async () => {
    const { exportId } = await db.transaction((tx) =>
      createExportRequest(tx, {
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
        sourceFingerprint: 'sha256:test-source',
        parametersFingerprint: 'sha256:test-params',
        engineVersion: ENGINE_VERSION,
        templateVersion: 'v1',
        requestedBy: td,
      }),
    );

    const worker = await startWorker({
      connectionString: url,
      reconcileIntervalMs: 3_600_000,
      exportStorageDir: storageDir,
      log: { log() {}, warn() {}, error() {} },
    });
    const sender = new PgBoss(url);
    try {
      await sender.start();
      await sender.send(EXPORT_QUEUE, { exportId });
      await waitFor(async () => (await getExport(db, exportId))?.status === 'READY', 30_000);

      const row = await getExport(db, exportId);
      expect(row?.status).toBe('READY');
      expect(row?.storageKey).toBeTruthy();
      expect(row?.outputFingerprint).toMatch(/^sha256:/);
      expect(row?.fileSha256).toMatch(/^sha256:/);

      const storage = localArtifactStorage(storageDir);
      const bytes = await storage.read(row?.storageKey ?? '');
      expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
      expect(bytes.byteLength).toBe(row?.sizeBytes);
    } finally {
      await sender.stop({ graceful: false });
      await worker.stop();
    }
  }, 40_000);

  it('a duplicate request with the same fingerprints reuses the existing export instead of regenerating', async () => {
    const args = {
      tournamentId: tournament,
      drawRunId,
      revisionId,
      revisionNo: 1,
      exportType: 'XLSX_WORKBOOK' as const,
      format: 'XLSX' as const,
      mode: 'PREVIEW' as const,
      scopeType: 'REVISION' as const,
      categoryId: null,
      poolId: null,
      sourceFingerprint: 'sha256:dup-source',
      parametersFingerprint: 'sha256:dup-params',
      engineVersion: ENGINE_VERSION,
      templateVersion: 'v1',
      requestedBy: td,
    };
    const first = await db.transaction((tx) => createExportRequest(tx, args));
    const second = await db.transaction((tx) => createExportRequest(tx, args));
    expect(second.exportId).toBe(first.exportId);
    expect(second.reused).toBe(true);
  });

  it('reconciliation closes out a stuck GENERATING export as FAILED with a stable code', async () => {
    const { exportId } = await db.transaction((tx) =>
      createExportRequest(tx, {
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
        sourceFingerprint: 'sha256:stuck-source',
        parametersFingerprint: 'sha256:stuck-params',
        engineVersion: ENGINE_VERSION,
        templateVersion: 'v1',
        requestedBy: td,
      }),
    );

    await db.query(
      `update export_artifact set status = 'GENERATING', started_at = now() - interval '1 hour' where id = $1`,
      [exportId],
    );

    const worker: WorkerHandle = await startWorker({
      connectionString: url,
      reconcileIntervalMs: 500,
      staleMs: 1_000,
      exportStorageDir: storageDir,
      log: { log() {}, warn() {}, error() {} },
    });
    try {
      await waitFor(async () => (await getExport(db, exportId))?.status === 'FAILED', 15_000);
      const row = await getExport(db, exportId);
      expect(row?.errorCode).toBe('EXPORT_GENERATION_FAILED');
    } finally {
      await worker.stop();
    }
  }, 30_000);
});
