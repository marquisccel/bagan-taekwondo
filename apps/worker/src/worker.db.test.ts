import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createDrawRun,
  MIGRATIONS_FOLDER,
  persistIntake,
  persistRuleSet,
  type Db,
  poolDb,
} from '@bagantkd/db';
import { newArena, newTournament, TEST_NIK_KEYS } from '@bagantkd/db/testing/seed';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DRAW_RUN_QUEUE, startWorker, type WorkerHandle } from './main.js';

/**
 * Worker integration (Phase 4, ADR-0002): pg-boss needs real LISTEN/NOTIFY and advisory-lock
 * behavior a wasm PGlite instance doesn't provide, so these tests run only against real
 * PostgreSQL (DATABASE_URL set — same as the "db" project's postgres backend), in a throwaway
 * database created and migrated for this run (mirrors testing/test-db.ts's postgres backend).
 */
const adminUrl = process.env['DATABASE_URL'];

async function createThrowawayDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const dbName = `bagantkd_worker_test_${randomBytes(6).toString('hex')}`;
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

describe.skipIf(!adminUrl)('worker (pg-boss + reconciliation) — postgres', () => {
  let db: Db;
  let pool: pg.Pool;
  let url: string;
  let dropDb: () => Promise<void>;
  let tournament: string;
  let officer: string;
  let ruleSetId: string;
  let snapshotId: string;

  beforeAll(async () => {
    const throwaway = await createThrowawayDatabase();
    url = throwaway.url;
    dropDb = throwaway.drop;
    pool = new pg.Pool({ connectionString: url, max: 5 });
    db = poolDb(pool);
    const t = await newTournament(db);
    tournament = t.tournament;
    officer = t.officer;
    await newArena(db, tournament);
    const persisted = await db.transaction((tx) =>
      persistRuleSet(tx, { tournamentId: tournament, actorId: officer, ruleSet }),
    );
    ruleSetId = persisted.ruleSetId;
    const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet });
    if (!intake.snapshot) throw new Error('no snapshot');
    const saved = await db.transaction((tx) =>
      persistIntake(tx, {
        tournamentId: tournament,
        ruleSetId,
        actorId: officer,
        result: intake,
        nikKeys: TEST_NIK_KEYS,
        mode: 'INITIAL',
      }),
    );
    snapshotId = saved.snapshotId;
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await dropDb();
  });

  async function newQueuedRun(): Promise<string> {
    const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet });
    if (!intake.snapshot) throw new Error('no snapshot');
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
        ruleSetId,
        ruleSetSnapshot: ruleSet,
        ruleSetFingerprint: plan.fingerprints.rules,
        intakeSnapshotId: snapshotId,
        intakeEntries: intake.snapshot?.entries ?? [],
        kind: 'CANDIDATE',
        seed: '20260827',
        scope,
        assumptions: null,
        requestedBy: officer,
      }),
    );
    return created.drawRunId;
  }

  it('pg-boss delivery executes a queued draw run; a redelivery of the same job afterward is a safe no-op', async () => {
    const drawRunId = await newQueuedRun();
    const worker = await startWorker({
      connectionString: url,
      reconcileIntervalMs: 3_600_000,
      log: { log() {}, warn() {}, error() {} },
    });
    const sender = new PgBoss(url);
    try {
      await sender.start();
      await sender.send(DRAW_RUN_QUEUE, { drawRunId });
      await waitFor(async () => {
        const [row] = await db.query<{ status: string }>(`select status from draw_run where id = $1`, [
          drawRunId,
        ]);
        return row?.status === 'SAFE';
      }, 20_000);

      // Redelivery (duplicate message, or a competing worker) must not re-execute or error.
      await sender.send(DRAW_RUN_QUEUE, { drawRunId });
      await new Promise((r) => setTimeout(r, 1_500));
      const [row] = await db.query<{ status: string; finished_at: string }>(
        `select status, finished_at from draw_run where id = $1`,
        [drawRunId],
      );
      expect(row?.status).toBe('SAFE');
    } finally {
      await sender.stop({ graceful: false });
      await worker.stop();
    }
  }, 30_000);

  it('the reconciliation timer requeues a stale QUEUED run whose pg-boss message was never sent', async () => {
    const drawRunId = await newQueuedRun();
    // Simulate a lost enqueue message: nothing is ever sent to pg-boss for this run. Backdate
    // requested_at past the stale threshold, exactly like draw-run.db.test.ts's reconciliation test.
    await db.query(`alter table draw_run disable trigger draw_run_guard`);
    try {
      await db.query(`update draw_run set requested_at = now() - interval '1 hour' where id = $1`, [
        drawRunId,
      ]);
    } finally {
      await db.query(`alter table draw_run enable trigger draw_run_guard`);
    }
    const worker: WorkerHandle = await startWorker({
      connectionString: url,
      reconcileIntervalMs: 500,
      staleMs: 1_000,
      log: { log() {}, warn() {}, error() {} },
    });
    try {
      await waitFor(async () => {
        const [row] = await db.query<{ status: string }>(`select status from draw_run where id = $1`, [
          drawRunId,
        ]);
        return row?.status === 'SAFE';
      }, 20_000);
    } finally {
      await worker.stop();
    }
  }, 30_000);
});
