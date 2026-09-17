import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';

import 'reflect-metadata';

import { MIGRATIONS_FOLDER, persistIntake, persistRuleSet, poolDb, type Db } from '@bagantkd/db';
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
 * API contract tests (Phase 4 §16): exercise the real HTTP layer (routing, the ActorGuard, the
 * error filter) end to end against real PostgreSQL, in a throwaway database.
 */
const adminUrl = process.env['DATABASE_URL'];

const root = (p: string) => join(__dirname, '../../../', p);
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

describe.skipIf(!adminUrl)('API contract — postgres', () => {
  let app: INestApplication;
  let db: Db;
  let dropDb: () => Promise<void>;
  let server: Server;
  let tournament: string;
  let officer: string;
  let viewer: string;
  let ruleSetId: string;
  let snapshotId: string;
  let readyScope: string[];

  beforeAll(async () => {
    const dbName = `bagantkd_api_test_${randomBytes(6).toString('hex')}`;
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
    viewer = t.viewer;
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
        nikKeys: { encryptionKey: new Uint8Array(32).fill(1), blindIndexKey: new Uint8Array(32).fill(2) },
        mode: 'INITIAL',
      }),
    );
    snapshotId = saved.snapshotId;
    const plan = runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'CANDIDATE',
      seed: parseDrawSeed('20260827'),
      ruleSet,
      entries: intake.snapshot.entries,
      scope: [],
      assumptions: null,
    });
    readyScope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);

    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
    server = app.getHttpServer();

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
  });

  it('rejects a request with no x-actor-id header', async () => {
    const res = await request(server).get(`/tournaments/${tournament}/audit`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UNAUTHORIZED_TOURNAMENT_ACCESS');
  });

  it('rejects a caller who is not a member of the tournament', async () => {
    const res = await request(server)
      .get(`/tournaments/${tournament}/audit`)
      .set('x-actor-id', '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UNAUTHORIZED_TOURNAMENT_ACCESS');
  });

  it('never trusts a client-supplied role: a VIEWER cannot create a draw run even if it claims otherwise in the body', async () => {
    const res = await request(server)
      .post(`/tournaments/${tournament}/draw-runs`)
      .set('x-actor-id', viewer)
      .send({
        ruleSetId,
        intakeSnapshotId: snapshotId,
        kind: 'CANDIDATE',
        seed: '1',
        scope: [],
        role: 'ADMIN',
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_COMMAND');
  });

  let drawRunId: string;
  let revisionId: string;

  it('creates a draw run, which the worker (not exercised here) would later execute', async () => {
    const res = await request(server)
      .post(`/tournaments/${tournament}/draw-runs`)
      .set('x-actor-id', officer)
      .send({
        ruleSetId,
        intakeSnapshotId: snapshotId,
        kind: 'CANDIDATE',
        seed: '20260827',
        scope: readyScope,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QUEUED');
    drawRunId = res.body.drawRunId;

    // Drive it to SAFE directly (no worker in this test) so downstream revision-command tests have
    // something to work with.
    const { executeDrawRun } = await import('@bagantkd/db');
    const exec = await executeDrawRun(db, drawRunId);
    expect(exec.output?.status).toBe('SAFE');
    const [rev] = await db.query<{ id: string }>(`select id from draw_revision where draw_run_id = $1`, [
      drawRunId,
    ]);
    revisionId = rev?.id ?? '';
    expect(revisionId).not.toBe('');
  }, 30_000);

  it('GET /draw-runs/:id returns the run without leaking the full rules snapshot', async () => {
    const res = await request(server).get(`/draw-runs/${drawRunId}`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SAFE');
    expect(res.body).not.toHaveProperty('rules_snapshot');
  });

  it('GET /draw-runs/:id/quality returns the persisted quality report', async () => {
    const res = await request(server).get(`/draw-runs/${drawRunId}/quality`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fingerprint');
  });

  it('GET /tournaments/:id returns a dashboard summary of the latest draw run and revision', async () => {
    const res = await request(server).get(`/tournaments/${tournament}`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.latestDrawRun).toMatchObject({ id: drawRunId, status: 'SAFE' });
    expect(res.body.latestRevision).toMatchObject({ id: revisionId, lifecycle: 'DRAFT' });
    expect(res.body.categoryCounts.total).toBeGreaterThan(0);
  });

  it('GET /tournaments/:id/members lists the tournament roster for the dev persona switcher', async () => {
    const res = await request(server).get(`/tournaments/${tournament}/members`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    const members = res.body as { user_id: string }[];
    expect(members.map((m) => m.user_id)).toContain(officer);
  });

  it('GET /tournaments/:id/search finds an entry by contingent name without leaking NIK', async () => {
    const [pool] = await db.query<{ id: string }>(`select id from pool where revision_id = $1 limit 1`, [
      revisionId,
    ]);
    const [member] = await db.query<{ entry_id: string }>(
      `select entry_id from pool_member where pool_id = $1 limit 1`,
      [pool?.id],
    );
    const [entry] = await db.query<{ contingent_id: string }>(
      `select contingent_id from entry where id = $1`,
      [member?.entry_id],
    );
    const [contingent] = await db.query<{ name: string }>(`select name from contingent where id = $1`, [
      entry?.contingent_id,
    ]);
    const res = await request(server)
      .get(`/tournaments/${tournament}/search`)
      .query({ q: (contingent?.name ?? '').slice(0, 4) })
      .set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/nik/i);
  });

  it('GET /revisions/:id returns revision metadata', async () => {
    const res = await request(server).get(`/revisions/${revisionId}`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: revisionId, lifecycle: 'DRAFT', lock_version: 0 });
  });

  it('GET /revisions/:id/categories lists categories with GREEN/YELLOW/RED derived from readiness and pool explanations', async () => {
    const res = await request(server).get(`/revisions/${revisionId}/categories`).set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const c of res.body) {
      expect(['GREEN', 'YELLOW', 'RED']).toContain(c.quality);
    }
  });

  it('GET /revisions/:id/categories/:categoryId returns pools and brackets with safe entry display fields (no NIK)', async () => {
    const [cat] = await db.query<{ category_id: string }>(
      `select category_id from draw_run_category where draw_run_id = $1 limit 1`,
      [drawRunId],
    );
    const res = await request(server)
      .get(`/revisions/${revisionId}/categories/${cat?.category_id}`)
      .set('x-actor-id', officer);
    expect(res.status).toBe(200);
    expect(res.body.pools.length).toBeGreaterThan(0);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/nik/i);
    const member = res.body.pools[0].members[0];
    expect(member).toHaveProperty('displayName');
    expect(member).toHaveProperty('contingent');
  });

  it('a nonexistent draw run is DRAW_RUN_NOT_FOUND (404), scoped through the guard by tournament', async () => {
    const res = await request(server)
      .get(`/draw-runs/00000000-0000-0000-0000-000000000000`)
      .set('x-actor-id', officer);
    expect(res.status).toBe(404);
  });

  it('a VIEWER cannot move an entry (FORBIDDEN_COMMAND, 403)', async () => {
    const [pool] = await db.query<{ pool_uid: string; id: string }>(
      `select pool_uid, id from pool where revision_id = $1 limit 1`,
      [revisionId],
    );
    const res = await request(server)
      .post(`/revisions/${revisionId}/commands/move-entry`)
      .set('x-actor-id', viewer)
      .send({
        entryId: '00000000-0000-0000-0000-000000000000',
        toPoolUid: pool?.pool_uid ?? '',
        toSlot: null,
        expectedLockVersion: 0,
        idempotencyKey: crypto.randomUUID(),
        reason: null,
        complaintId: null,
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_COMMAND');
  });

  it('a stale expectedLockVersion is REVISION_CONFLICT (409)', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/submit-review`)
      .set('x-actor-id', officer)
      .send({
        expectedLockVersion: 999,
        idempotencyKey: crypto.randomUUID(),
        reason: null,
        complaintId: null,
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVISION_CONFLICT');
  });

  it('submit-review applies with the correct lock_version, and the audit trail records it', async () => {
    const res = await request(server)
      .post(`/revisions/${revisionId}/submit-review`)
      .set('x-actor-id', officer)
      .send({ expectedLockVersion: 0, idempotencyKey: crypto.randomUUID(), reason: null, complaintId: null });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('APPLIED');

    const audit = await request(server).get(`/tournaments/${tournament}/audit`).set('x-actor-id', viewer);
    expect(audit.status).toBe(200);
    expect(audit.body.events.length).toBeGreaterThan(0);
    expect(audit.body.events[0].action).toBe('LIFECYCLE_SUBMIT');
  });

  it('a validation error (missing field) is VALIDATION_ERROR (400), not a 500', async () => {
    const res = await request(server)
      .post(`/tournaments/${tournament}/draw-runs`)
      .set('x-actor-id', officer)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
