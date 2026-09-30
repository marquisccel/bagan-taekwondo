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
 * Pre-UAT read contracts: GET /tournaments (AUD-008), GET /tournaments/:id/entries (AUD-009) and
 * GET /tournaments/:id/draw-preflight (AUD-010), over the real HTTP layer + ActorGuard on real
 * PostgreSQL in a throwaway database (same harness as api.contract.db.test.ts).
 */
const adminUrl = process.env['DATABASE_URL'];

const root = (p: string) => join(__dirname, '../../../', p);
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));
const csvNiks = csv
  .toString('utf-8')
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(',')[2] ?? '')
  .filter((n) => /^\d{16}$/.test(n));

interface EntryItem {
  entryId: string;
  displayName: string;
  contingent: string;
  format: string;
  members: { position: number; fullName: string | null }[];
  category: { id: string; displayName: string } | null;
  eligibilityStatus: string;
  eligibilityReasons: string[];
  group: unknown;
  issues: { code: string; severity: string; status: string }[];
  openIssueCounts: { error: number; warning: number; info: number };
}
interface EntriesBody {
  items: EntryItem[];
  total: number;
  limit: number;
  offset: number;
  facets: { categories: { id: string; displayName: string }[] };
}

describe.skipIf(!adminUrl)('UAT read contracts — postgres', () => {
  let app: INestApplication;
  let db: Db;
  let dropDb: () => Promise<void>;
  let server: Server;
  let tournament: string;
  let officer: string;
  let viewer: string;
  let ruleSetId: string;
  let snapshotId: string;
  let otherTournament: string;
  let otherTd: string;

  beforeAll(async () => {
    const dbName = `bagantkd_uat_test_${randomBytes(6).toString('hex')}`;
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

    // A second tournament with its own (unrelated) member: must never leak into the first one's list.
    const other = await newTournament(db);
    otherTournament = other.tournament;
    otherTd = other.td;

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

  const get = (path: string, actor?: string) => {
    const r = request(server).get(path);
    return actor ? r.set('x-actor-id', actor) : r;
  };

  describe('GET /tournaments', () => {
    it('requires an identified actor', async () => {
      const res = await get('/tournaments');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('UNAUTHORIZED_TOURNAMENT_ACCESS');
    });

    it('lists only tournaments the actor is a member of, with operational fields', async () => {
      const res = await get('/tournaments', officer);
      expect(res.status).toBe(200);
      const list = res.body as { id: string; code: string; name: string }[];
      expect(list.map((t) => t.id)).toEqual([tournament]);
      expect(res.body[0]).toMatchObject({
        id: tournament,
        name: 'T',
        status: 'DRAFT',
        eventStart: '2026-08-27',
        eventEnd: '2026-08-30',
        activeRuleSetStatus: 'ACTIVE',
        latestDrawRun: null,
        latestRevision: null,
        categoryCounts: { total: 0, ready: 0, blocked: 0 },
      });
      expect(res.body[0].code).toMatch(/^T_/);

      // Semi-prestasi only (AUD-008 list refinement) -- cross-checked against the database directly
      // rather than a hardcoded number, so this stays correct regardless of the fixture's own mix of
      // semi-prestasi/prestasi entries; the point is the SQL's own stream filter, not a fixed count.
      const [expectedTotals] = await db.query<{ entries: string; contingents: string }>(
        `select count(distinct id) as entries, count(distinct contingent_id) as contingents
         from entry where tournament_id = $1 and declared_stream = 'SEMI_PRESTASI'`,
        [tournament],
      );
      expect(res.body[0].totalEntries).toBe(Number(expectedTotals?.entries ?? 0));
      expect(res.body[0].totalContingents).toBe(Number(expectedTotals?.contingents ?? 0));
      expect(res.body[0].totalEntries).toBeGreaterThan(0);

      const other = await get('/tournaments', otherTd);
      expect((other.body as { id: string }[]).map((t) => t.id)).toEqual([otherTournament]);
    });

    it('a viewer sees the tournament too; a stranger and a malformed actor id see an empty list (never a 500)', async () => {
      const v = await get('/tournaments', viewer);
      expect((v.body as { id: string }[]).map((t) => t.id)).toEqual([tournament]);
      const stranger = await get('/tournaments', '00000000-0000-0000-0000-000000000000');
      expect(stranger.status).toBe(200);
      expect(stranger.body).toEqual([]);
      const junk = await get('/tournaments', 'not-a-uuid');
      expect(junk.status).toBe(200);
      expect(junk.body).toEqual([]);
    });
  });

  describe('GET /tournaments/:id/entries', () => {
    it('rejects non-members (403) and validates query params (400)', async () => {
      expect((await get(`/tournaments/${tournament}/entries`, otherTd)).status).toBe(403);
      for (const q of ['discipline=BOXING', 'eligibility=MAYBE', 'limit=0', 'limit=9999', 'categoryId=zzz']) {
        const res = await get(`/tournaments/${tournament}/entries?${q}`, officer);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('lists persisted entries with pagination and never leaks a NIK', async () => {
      const all = await get(`/tournaments/${tournament}/entries?limit=200`, officer);
      expect(all.status).toBe(200);
      const body = all.body as EntriesBody;
      expect(body.total).toBeGreaterThan(5);
      expect(body.items).toHaveLength(body.total);

      const page = await get(`/tournaments/${tournament}/entries?limit=3&offset=2`, officer);
      const pageBody = page.body as EntriesBody;
      expect(pageBody).toMatchObject({ total: body.total, limit: 3, offset: 2 });
      expect(pageBody.items.map((i) => i.entryId)).toEqual(body.items.slice(2, 5).map((i) => i.entryId));

      const text = JSON.stringify(body);
      expect(csvNiks.length).toBeGreaterThan(0);
      for (const nik of csvNiks) expect(text).not.toContain(nik);
      expect(text).not.toMatch(/nik_ciphertext|nik_blind_index|nikCiphertext|rawValue|raw_value/);
    });

    it('shows persisted eligibility, blocking reasons and validation issues (no re-derivation)', async () => {
      const res = await get(`/tournaments/${tournament}/entries?limit=200`, officer);
      const items = (res.body as EntriesBody).items;
      const persisted = await db.query<{ id: string; eligibility_status: string }>(
        `select id, eligibility_status from entry where tournament_id = $1`,
        [tournament],
      );
      for (const p of persisted)
        expect(items.find((i) => i.entryId === p.id)?.eligibilityStatus).toBe(p.eligibility_status);
      const blocked = items.filter((i) => i.eligibilityStatus === 'BLOCKED');
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.some((i) => i.eligibilityReasons.length > 0)).toBe(true);
      const withIssue = items.filter((i) => i.issues.length > 0);
      expect(withIssue.length).toBeGreaterThan(0);
      for (const i of withIssue) {
        for (const issue of i.issues) {
          expect(issue.code).toBeTruthy();
          expect(['ERROR', 'WARNING', 'INFO']).toContain(issue.severity);
        }
        expect(i.openIssueCounts.error + i.openIssueCounts.warning + i.openIssueCounts.info).toBe(
          i.issues.filter((x) => x.status === 'OPEN').length,
        );
      }
    });

    it('groups pair/team members under one entry with all member names and the format', async () => {
      const res = await get(`/tournaments/${tournament}/entries?limit=200`, officer);
      const items = (res.body as EntriesBody).items;
      const multi = items.filter((i) => i.members.length > 1);
      expect(multi.length).toBeGreaterThan(0);
      for (const m of multi) {
        expect(['PAIR', 'TEAM']).toContain(m.format);
        for (const member of m.members) if (member.fullName) expect(m.displayName).toContain(member.fullName);
        expect(m.group).not.toBeNull();
      }
    });

    it('filters by participant name, contingent, discipline, eligibility and open issues', async () => {
      const all = (await get(`/tournaments/${tournament}/entries?limit=200`, officer)).body as EntriesBody;
      const firstMember = all.items.flatMap((i) => i.members).find((m) => m.fullName);
      const nameTerm = (firstMember?.fullName ?? '').slice(0, 8);
      const byName = (await get(`/tournaments/${tournament}/entries`, officer).query({ q: nameTerm }))
        .body as EntriesBody;
      expect(byName.items.length).toBeGreaterThan(0);
      expect(byName.items.every((i) => i.displayName.toLowerCase().includes(nameTerm.toLowerCase()))).toBe(
        true,
      );

      const contingent = all.items[0]?.contingent ?? '';
      const byContingent = (
        await get(`/tournaments/${tournament}/entries`, officer).query({ contingent: contingent.slice(0, 5) })
      ).body as EntriesBody;
      expect(byContingent.items.length).toBeGreaterThan(0);
      expect(
        byContingent.items.every((i) =>
          i.contingent.toLowerCase().includes(contingent.slice(0, 5).toLowerCase()),
        ),
      ).toBe(true);

      const poomsae = (await get(`/tournaments/${tournament}/entries?discipline=POOMSAE&limit=200`, officer))
        .body as EntriesBody;
      const [nRow] = await db.query<{ n: string }>(
        `select count(*) n from entry where tournament_id = $1 and declared_discipline = 'POOMSAE'`,
        [tournament],
      );
      expect(poomsae.total).toBe(Number(nRow?.n));
      expect(poomsae.total).toBeGreaterThan(0);

      const blocked = (await get(`/tournaments/${tournament}/entries?eligibility=BLOCKED&limit=200`, officer))
        .body as EntriesBody;
      expect(blocked.items.length).toBeGreaterThan(0);
      expect(blocked.items.every((i) => i.eligibilityStatus === 'BLOCKED')).toBe(true);

      const withIssues = (await get(`/tournaments/${tournament}/entries?hasIssues=true&limit=200`, officer))
        .body as EntriesBody;
      expect(withIssues.items.length).toBeGreaterThan(0);
      expect(
        withIssues.items.every(
          (i) => i.openIssueCounts.error + i.openIssueCounts.warning + i.openIssueCounts.info > 0,
        ),
      ).toBe(true);

      const nothing = (
        await get(`/tournaments/${tournament}/entries`, officer).query({ q: 'zzzz-no-such-name' })
      ).body as EntriesBody;
      expect(nothing).toMatchObject({ items: [], total: 0 });
    });

    it('treats LIKE wildcards in search terms literally', async () => {
      const res = await get(`/tournaments/${tournament}/entries`, officer).query({ q: '%' });
      expect((res.body as EntriesBody).total).toBe(0);
    });

    it('shows the human-readable category once a draw run has assigned one, and filters by it', async () => {
      const before = (await get(`/tournaments/${tournament}/entries?limit=200`, officer)).body as EntriesBody;
      expect(before.items.every((i) => i.category === null)).toBe(true);
      const unassigned = (await get(`/tournaments/${tournament}/entries?categoryId=NONE&limit=200`, officer))
        .body as EntriesBody;
      expect(unassigned.total).toBe(before.total);

      const plan = runDraw({
        engineVersion: ENGINE_VERSION,
        purpose: 'CANDIDATE',
        seed: parseDrawSeed('20260827'),
        ruleSet,
        entries: runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet }).snapshot?.entries ?? [],
        scope: [],
        assumptions: null,
      });
      const readyScope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
      const created = await request(server)
        .post(`/tournaments/${tournament}/draw-runs`)
        .set('x-actor-id', officer)
        .send({
          ruleSetId,
          intakeSnapshotId: snapshotId,
          kind: 'CANDIDATE',
          seed: '20260827',
          scope: readyScope,
        });
      expect(created.status).toBe(201);
      const { executeDrawRun } = await import('@bagantkd/db');
      const exec = await executeDrawRun(db, created.body.drawRunId as string);
      expect(exec.output?.status).toBe('SAFE');

      const after = (await get(`/tournaments/${tournament}/entries?limit=200`, officer)).body as EntriesBody;
      const assigned = after.items.filter((i) => i.category);
      expect(assigned.length).toBeGreaterThan(0);
      for (const i of assigned) {
        // Human-readable Indonesian title, never the raw categoryKey.
        expect(i.category?.displayName).toMatch(/^(Kyorugi|Poomsae)/);
        expect(i.category?.displayName).not.toContain('|');
        expect(i.category?.displayName).not.toContain('=');
      }
      expect(after.facets.categories.length).toBeGreaterThan(0);
      const facet = after.facets.categories[0];
      const filtered = (
        await get(`/tournaments/${tournament}/entries?categoryId=${facet?.id}&limit=200`, officer)
      ).body as EntriesBody;
      expect(filtered.items.length).toBeGreaterThan(0);
      expect(filtered.items.every((i) => i.category?.id === facet?.id)).toBe(true);

      // The list endpoint now also reports the latest draw run/revision/category counts for the tournament.
      const list = await get('/tournaments', officer);
      expect(list.body[0].latestDrawRun).toMatchObject({ id: created.body.drawRunId, status: 'SAFE' });
      expect(list.body[0].latestRevision).toMatchObject({ lifecycle: 'DRAFT' });
      expect(list.body[0].categoryCounts.total).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('GET /tournaments/:id/draw-preflight', () => {
    it('rejects non-members', async () => {
      expect((await get(`/tournaments/${tournament}/draw-preflight`, otherTd)).status).toBe(403);
    });

    it('reports rule set, snapshot, persisted eligibility counts, open issues and provisional findings', async () => {
      const res = await get(`/tournaments/${tournament}/draw-preflight`, officer);
      expect(res.status).toBe(200);
      const b = res.body;
      expect(b.role).toBe('DRAWING_OFFICER');
      expect(b.canRequest).toBe(true);
      expect(b.blockers).toEqual([]);
      expect(b.ruleSet).toMatchObject({ id: ruleSetId, status: 'ACTIVE' });
      expect(b.intakeSnapshot.id).toBe(snapshotId);

      const [counts] = await db.query<{ total: string; eligible: string }>(
        `select count(*) total, count(*) filter (where eligibility_status in ('READY','OVERRIDDEN','DRAWN')) eligible from entry where tournament_id = $1`,
        [tournament],
      );
      expect(b.entries).toEqual({
        total: Number(counts?.total),
        eligible: Number(counts?.eligible),
        blocked: Number(counts?.total) - Number(counts?.eligible),
      });
      expect(b.entries.blocked).toBeGreaterThan(0);

      const [errRow] = await db.query<{ errors: string }>(
        `select count(*) errors from validation_issue where tournament_id = $1 and status = 'OPEN' and severity = 'ERROR'`,
        [tournament],
      );
      expect(b.openIssues.error).toBe(Number(errRow?.errors));

      // The shipped fixture is provisional: the existing LOCK assessment says so, we only relay it.
      expect(b.ruleSetLock.lockable).toBe(false);
      expect(b.ruleSetLock.blockerCount).toBeGreaterThan(0);
      const codes = (b.ruleSetLock.findings as { code: string; level: string }[]).map((f) => f.code);
      expect(codes).toContain('RULE_SET_NOT_ACTIVE');
      expect(JSON.stringify(b)).not.toMatch(/nik/i);
    });

    it('tells a viewer they cannot request a draw, and flags a tournament without an ACTIVE rule set', async () => {
      const v = await get(`/tournaments/${tournament}/draw-preflight`, viewer);
      expect(v.body).toMatchObject({ role: 'VIEWER', canRequest: false });

      const o = await get(`/tournaments/${otherTournament}/draw-preflight`, otherTd);
      expect(o.status).toBe(200);
      expect(o.body.blockers).toEqual(['NO_ACTIVE_RULE_SET']);
      expect(o.body.intakeSnapshot).toBeNull();
      expect(o.body.entries).toEqual({ total: 0, eligible: 0, blocked: 0 });
    });
  });
});
