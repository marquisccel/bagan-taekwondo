import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

import 'reflect-metadata';

import { MIGRATIONS_FOLDER, poolDb, type Db } from '@bagantkd/db';
import { newArena, newTournament } from '@bagantkd/db/testing/seed';
import { kyorugiSemiCsv, provisionalRuleSet, seedDrawnRevision } from '@bagantkd/db/testing/seed-revision';
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
 * AUD-005 / AUD-007 over real HTTP + PostgreSQL: a refused MoveEntry / SwapEntries reaches the
 * client as a stable `{ code, message, details: { verdict } }` with a 422 (never a stack trace),
 * and an applied one returns the server's verdict with its impact.
 */
const adminUrl = process.env['DATABASE_URL'];
const athlete = (name: string, heightCm: number, contingent: string) => ({
  name,
  contingent,
  heightCm,
  weightKg: 44,
  belt: 'GEUP 9 - KUNING',
});

describe.skipIf(!adminUrl)('API command verdict contract — postgres', () => {
  let app: INestApplication;
  let db: Db;
  let dropDb: () => Promise<void>;
  let server: Server;
  let officer: string;
  let revisionId: string;
  let shortPool: string;
  let tallPool: string;
  let shorts: string[];

  const post = (path: string, body: Record<string, unknown>) =>
    request(server).post(path).set('x-actor-id', officer).send(body);
  const lock = async () =>
    (
      await db.query<{ lock_version: number }>(`select lock_version from draw_revision where id = $1`, [
        revisionId,
      ])
    )[0]?.lock_version ?? -1;
  const idem = () => randomBytes(8).toString('hex') + '-' + randomBytes(8).toString('hex');

  beforeAll(async () => {
    const dbName = `bagantkd_api_verdict_${randomBytes(6).toString('hex')}`;
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
    officer = t.officer;
    await newArena(db, t.tournament);
    ({ revisionId } = await seedDrawnRevision(
      db as never,
      { tournamentId: t.tournament, actorId: t.officer },
      provisionalRuleSet,
      kyorugiSemiCsv([
        ...[150, 151, 152, 153].map((h, i) => athlete(`Pendek ${i + 1}`, h, `Kota ${'ABAC'[i]}`)),
        ...[170, 171, 172].map((h, i) => athlete(`Tinggi ${i + 1}`, h, `Kota ${'ABC'[i]}`)),
      ]),
    ));
    const rows = await db.query<{ pool_uid: string; ordinal: number; entry_id: string }>(
      `select p.pool_uid, p.ordinal, pm.entry_id from pool p join pool_member pm on pm.pool_id = p.id where p.revision_id = $1 order by p.ordinal`,
      [revisionId],
    );
    shortPool = rows.find((r) => r.ordinal === 1)?.pool_uid ?? '';
    tallPool = rows.find((r) => r.ordinal === 2)?.pool_uid ?? '';
    shorts = rows.filter((r) => r.ordinal === 1).map((r) => r.entry_id);

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
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await dropDb();
  });

  const move = async (entryId: string, toPoolUid: string, reason: string | null) =>
    post(`/revisions/${revisionId}/commands/move-entry`, {
      entryId,
      toPoolUid,
      toSlot: null,
      expectedLockVersion: await lock(),
      idempotencyKey: idem(),
      reason,
      complaintId: null,
    });

  it('a soft degradation without a reason is 422 REASON_REQUIRED with the verdict in details', async () => {
    const res = await move(shorts[0] as string, tallPool, null);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'REASON_REQUIRED',
      details: { verdict: { level: 'YELLOW', reasonRequired: true } },
    });
    expect(res.body.details.verdict.softViolations).toContain('HEIGHT_TOLERANCE_WORSENED');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\(.*:\d+:\d+\)/i);
  });

  it('with a reason it applies and returns the server verdict + impact', async () => {
    const res = await move(shorts[0] as string, tallPool, 'Komplain nomor K-7');
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('APPLIED');
    expect(res.body.verdict.level).toBe('YELLOW');
    expect(res.body.verdict.impact.change).toBe('WORSE');
  });

  it('a hard violation is 422 HARD_CONSTRAINT_VIOLATED with machine-readable codes and changes nothing', async () => {
    const before = await lock();
    const res = await move(shorts[1] as string, tallPool, 'tetap pindahkan');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'HARD_CONSTRAINT_VIOLATED',
      details: { verdict: { level: 'RED', hardViolations: ['POOL_SIZE_EXCEEDED'] } },
    });
    expect(await lock()).toBe(before);
    expect(shortPool).not.toBe('');
  });

  it('a GREEN improvement returns the verdict without asking for a reason', async () => {
    const res = await move(shorts[0] as string, shortPool, null);
    expect(res.status).toBe(201);
    expect(res.body.verdict).toMatchObject({ level: 'GREEN', impact: { change: 'IMPROVED' } });
  });
});
