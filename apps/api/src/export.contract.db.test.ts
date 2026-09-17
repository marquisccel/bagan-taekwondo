import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import 'reflect-metadata';

import {
  claimExport,
  completeExport,
  MIGRATIONS_FOLDER,
  persistIntake,
  persistRuleSet,
  poolDb,
  type Db,
} from '@bagantkd/db';
import { newArena, newTournament } from '@bagantkd/db/testing/seed';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module';
import { DomainErrorFilter } from './errors/domain-error.filter';

/**
 * Phase 6 export API contract tests: real HTTP layer (ActorGuard's new 'export' scope, the export
 * policy gate, the error filter's new codes) against real PostgreSQL, in a throwaway database. The
 * worker is never started here (matches api.contract.db.test.ts's convention) — generation itself
 * is proved end to end by apps/worker/src/export-worker.db.test.ts.
 */
const adminUrl = process.env['DATABASE_URL'];

const root = (p: string) => join(__dirname, '../../../', p);
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

/** No LOCK blockers, so LOCK/PUBLISH can be exercised via HTTP (mirrors packages/db/src/command.db.test.ts). */
function lockableRuleSet(rs: RuleSet): RuleSet {
  return {
    ...rs,
    status: 'ACTIVE',
    categoryTemplates: rs.categoryTemplates.map((t) =>
      t.provenance.source === 'TBD' ? { ...t, provenance: { source: 'COMMITTEE' } } : t,
    ),
    poolPolicies: rs.poolPolicies.map((p) => ({
      ...p,
      tolerances: p.tolerances.map((t) =>
        t.max.status === 'UNSET'
          ? { ...t, max: { status: 'NONE' as const, provenance: { source: 'COMMITTEE' as const } } }
          : t,
      ),
    })),
  };
}

describe.skipIf(!adminUrl)('export API contract — postgres', () => {
  let app: INestApplication;
  let db: Db;
  let dropDb: () => Promise<void>;
  let server: Server;
  let tournament: string;
  let officer: string;
  let td: string;
  let viewer: string;
  let revisionId: string;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'bagantkd-export-api-'));
    process.env['EXPORT_STORAGE_DIR'] = storageDir;
    const dbName = `bagantkd_export_api_test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const parsed = new URL(adminUrl as string);
    parsed.pathname = `/${dbName}`;
    const url = parsed.toString();
    const migratePool = new pg.Pool({ connectionString: url, max: 4 });
    await migrate(drizzle(migratePool), { migrationsFolder: MIGRATIONS_FOLDER });
    await migratePool.end();
    process.env['DATABASE_URL'] = url;

    const pool = new pg.Pool({ connectionString: url, max: 5 });
    db = poolDb(pool);
    const t = await newTournament(db);
    tournament = t.tournament;
    officer = t.officer;
    td = t.td;
    viewer = t.viewer;
    await newArena(db, tournament);
    const lockable = lockableRuleSet(ruleSet);
    const persisted = await db.transaction((tx) =>
      persistRuleSet(tx, { tournamentId: tournament, actorId: officer, ruleSet: lockable }),
    );
    const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet: lockable });
    if (!intake.snapshot) throw new Error('no snapshot');
    const saved = await db.transaction((tx) =>
      persistIntake(tx, {
        tournamentId: tournament,
        ruleSetId: persisted.ruleSetId,
        actorId: officer,
        result: intake,
        nikKeys: { encryptionKey: new Uint8Array(32).fill(1), blindIndexKey: new Uint8Array(32).fill(2) },
        mode: 'INITIAL',
      }),
    );
    const plan = runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'CANDIDATE',
      seed: parseDrawSeed('20260827'),
      ruleSet: lockable,
      entries: intake.snapshot.entries,
      scope: [],
      assumptions: null,
    });
    const readyScope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);

    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
    server = app.getHttpServer();

    const { createDrawRun, executeDrawRun } = await import('@bagantkd/db');
    const created = await db.transaction((tx) =>
      createDrawRun(tx, {
        tournamentId: tournament,
        ruleSetId: persisted.ruleSetId,
        ruleSetSnapshot: lockable,
        ruleSetFingerprint: plan.fingerprints.rules,
        intakeSnapshotId: saved.snapshotId,
        intakeEntries: intake.snapshot?.entries ?? [],
        kind: 'CANDIDATE',
        seed: '20260827',
        scope: readyScope,
        assumptions: null,
        requestedBy: officer,
      }),
    );
    await executeDrawRun(db, created.drawRunId);
    const [rev] = await db.query<{ id: string }>(`select id from draw_revision where draw_run_id = $1`, [
      created.drawRunId,
    ]);
    revisionId = rev?.id ?? '';

    dropDb = async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${dbName} with (force)`);
      await cleanup.end();
    };
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await dropDb();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('a VIEWER cannot request even a PREVIEW export (role below DRAWING_OFFICER)', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', viewer)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'PREVIEW' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXPORT_UNAUTHORIZED');
  });

  it('a DRAWING_OFFICER cannot request an OFFICIAL export (needs TECHNICAL_DELEGATE+)', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', officer)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'OFFICIAL' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXPORT_UNAUTHORIZED');
  });

  it('a TECHNICAL_DELEGATE cannot request an OFFICIAL export while the revision is still DRAFT', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', td)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'OFFICIAL' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_REVISION_NOT_ALLOWED');
  });

  let previewExportId: string;

  it('a DRAWING_OFFICER can request a PREVIEW export from a DRAFT revision', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', officer)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'PREVIEW' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      mode: 'PREVIEW',
      exportType: 'TOURNAMENT_DRAW_BOOK',
    });
    expect(res.body.sourceFingerprint).toMatch(/^sha256:/);
    expect(res.body.parametersFingerprint).toMatch(/^sha256:/);
    // Never leaks the internal storage key or draw_run_id as client-facing identity.
    expect(res.body).not.toHaveProperty('storageKey');
    expect(res.body).not.toHaveProperty('drawRunId');
    previewExportId = res.body.id;
  });

  it('an identical retry reuses the same export instead of creating a duplicate', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', officer)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'PREVIEW' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(previewExportId);
  });

  it('GET /exports/:id returns the export (worker not exercised here, so still REQUESTED)', async () => {
    const res = await request(server).get(`/exports/${previewExportId}`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REQUESTED');
  });

  it('GET /revisions/:id/exports lists it', async () => {
    const res = await request(server).get(`/revisions/${revisionId}/exports`).set('x-actor-id', viewer);
    expect(res.status).toBe(200);
    const list = res.body as { id: string }[];
    expect(list.some((e) => e.id === previewExportId)).toBe(true);
  });

  it('GET /exports/:id/file on a REQUESTED export is EXPORT_NOT_READY (409), not a 500', async () => {
    const res = await request(server).get(`/exports/${previewExportId}/file`).set('x-actor-id', officer);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_NOT_READY');
  });

  it('an unknown export id is a 404 at the tournament-scope guard, same as an unknown revision id (Phase 4 convention)', async () => {
    const res = await request(server).get(`/exports/${randomUUID()}`).set('x-actor-id', officer);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TOURNAMENT_NOT_FOUND');
  });

  it('a category id that does not belong to this revision is EXPORT_SOURCE_NOT_FOUND (404)', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', officer)
      .send({ exportType: 'CATEGORY_DRAW', mode: 'PREVIEW', categoryId: randomUUID() });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EXPORT_SOURCE_NOT_FOUND');
  });

  it('a scoped export type without its required id is VALIDATION_ERROR (400)', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', officer)
      .send({ exportType: 'CATEGORY_DRAW', mode: 'PREVIEW' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('once completed (simulated here without the worker), a VIEWER can download the READY file', async () => {
    await claimExport(db, previewExportId);
    await completeExport(db, previewExportId, {
      storageKey: '__unused_in_this_test__',
      filename: 'x.pdf',
      sizeBytes: 4,
      outputFingerprint: 'sha256:' + 'a'.repeat(64),
      fileSha256: 'sha256:' + 'b'.repeat(64),
    });
    // completeExport writes via storage in production (the worker); here we bypass the worker
    // entirely, so write the file directly into the same temp directory the app's
    // ExportStorageModule was configured with (EXPORT_STORAGE_DIR, set in beforeAll).
    const { localArtifactStorage } = await import('@bagantkd/export');
    const storage = localArtifactStorage(storageDir);
    await storage.write('__unused_in_this_test__', new TextEncoder().encode('%PDF-fake'));

    const res = await request(server).get(`/exports/${previewExportId}/file`).set('x-actor-id', viewer);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('x.pdf');
  });

  it('LOCK -> PUBLISH via HTTP, then a TECHNICAL_DELEGATE can request an OFFICIAL export', async () => {
    const cmd = (action: string, expectedLockVersion: number) =>
      request(server)
        .post(`/revisions/${revisionId}/${action}`)
        .set('x-actor-id', td)
        .send({ expectedLockVersion, idempotencyKey: randomUUID(), reason: 'e2e', complaintId: null });

    const submit = await cmd('submit-review', 0);
    expect(submit.status).toBe(201);
    const approve = await cmd('approve', 1);
    expect(approve.status).toBe(201);
    const lock = await cmd('lock', 2);
    expect(lock.status).toBe(201);
    const publish = await cmd('publish', 3);
    expect(publish.status).toBe(201);

    const res = await request(server)
      .post(`/revisions/${revisionId}/exports`)
      .set('x-actor-id', td)
      .send({ exportType: 'TOURNAMENT_DRAW_BOOK', mode: 'OFFICIAL' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mode: 'OFFICIAL', status: 'REQUESTED' });
  });
});
