import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { DrawCommand } from '@bagantkd/domain';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyDrawCommand, type CommandActor } from './command-repository.js';
import { createDrawRun, executeDrawRun } from './draw-run-repository.js';
import { persistIntake } from './intake-repository.js';
import { persistRuleSet } from './rule-set-repository.js';
import { newArena, newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * Phase 4 — domain commands: authorization, optimistic concurrency, idempotency, revision
 * lifecycle, audit integrity, and match-code stability across an amendment.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

/** A rule set patched to have no LOCK blockers, so the LOCK/PUBLISH/AMEND lifecycle can be exercised. */
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

for (const backend of testBackends()) {
  describe(`draw commands — ${backend.name}`, () => {
    let db: TestDb;
    let tournament: string;
    let officer: string;
    let viewer: string;
    let revisionId: string;
    let entryA: string;
    let entryB: string;
    let poolAUid: string;
    let poolBUid: string;
    const cmdKey = () => randomUUID();
    const asOfficer = (): CommandActor => ({ userId: officer, role: 'DRAWING_OFFICER' });
    const asViewer = (): CommandActor => ({ userId: viewer, role: 'VIEWER' });

    /** Builds a fresh SAFE CANDIDATE run and its DRAFT revision 1; returns two entries in two different pools of the same category, if one exists with ≥ 2 pools. */
    async function seedRevision(
      rs: RuleSet,
      ctx: { tournamentId: string; actorId: string } = { tournamentId: tournament, actorId: officer },
    ): Promise<{ revisionId: string; entryA: string; entryB: string; poolAUid: string; poolBUid: string }> {
      const persisted = await db.transaction((tx) =>
        persistRuleSet(tx, { tournamentId: ctx.tournamentId, actorId: ctx.actorId, ruleSet: rs }),
      );
      const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet: rs });
      if (!intake.snapshot) throw new Error('no snapshot');
      const entries = intake.snapshot.entries;
      const saved = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: ctx.tournamentId,
          ruleSetId: persisted.ruleSetId,
          actorId: ctx.actorId,
          result: intake,
          nikKeys: TEST_NIK_KEYS,
          mode: 'INITIAL',
        }),
      );
      const plan = runDraw({
        engineVersion: ENGINE_VERSION,
        purpose: 'CANDIDATE',
        seed: parseDrawSeed('20260827'),
        ruleSet: rs,
        entries,
        scope: [],
        assumptions: null,
      });
      const scope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
      const created = await db.transaction((tx) =>
        createDrawRun(tx, {
          tournamentId: ctx.tournamentId,
          ruleSetId: persisted.ruleSetId,
          ruleSetSnapshot: rs,
          ruleSetFingerprint: persisted.fingerprint,
          intakeSnapshotId: saved.snapshotId,
          intakeEntries: entries,
          kind: 'CANDIDATE',
          seed: '20260827',
          scope,
          assumptions: null,
          requestedBy: ctx.actorId,
        }),
      );
      const exec = await executeDrawRun(db, created.drawRunId);
      if (exec.output?.status !== 'SAFE') throw new Error('expected SAFE draw run');
      const [rev] = await db.query<{ id: string }>(`select id from draw_revision where draw_run_id = $1`, [
        created.drawRunId,
      ]);
      const pools = await db.query<{ pool_uid: string; entries: number }>(
        `select p.pool_uid, count(pm.entry_id)::int as entries from pool p join pool_member pm on pm.pool_id = p.id where p.revision_id = $1 group by p.id, p.pool_uid having count(pm.entry_id) >= 1 order by p.pool_uid`,
        [rev?.id],
      );
      const multi = await db.query<{ category_id: string; n: number }>(
        `select category_id, count(*)::int as n from pool where revision_id = $1 group by category_id having count(*) >= 2 limit 1`,
        [rev?.id],
      );
      if (multi.length) {
        // Two pools of the SAME category exist: entryA/entryB come from different pools, one MOVE_ENTRY apart.
        const catPools = await db.query<{ pool_uid: string }>(
          `select pool_uid from pool where revision_id = $1 and category_id = $2 order by ordinal limit 2`,
          [rev?.id, multi[0]?.category_id],
        );
        const poolAUidLocal = catPools?.[0]?.pool_uid ?? '';
        const poolBUidLocal = catPools?.[1]?.pool_uid ?? poolAUidLocal;
        const [pa] = await db.query<{ id: string }>(
          `select id from pool where revision_id = $1 and pool_uid = $2`,
          [rev?.id, poolAUidLocal],
        );
        const [pb] = await db.query<{ id: string }>(
          `select id from pool where revision_id = $1 and pool_uid = $2`,
          [rev?.id, poolBUidLocal],
        );
        const [ea] = await db.query<{ entry_id: string }>(
          `select entry_id from pool_member where pool_id = $1 limit 1`,
          [pa?.id],
        );
        const [eb] = await db.query<{ entry_id: string }>(
          `select entry_id from pool_member where pool_id = $1 limit 1`,
          [pb?.id],
        );
        return {
          revisionId: rev?.id ?? '',
          entryA: ea?.entry_id ?? '',
          entryB: eb?.entry_id ?? '',
          poolAUid: poolAUidLocal,
          poolBUid: poolBUidLocal,
        };
      }
      // No category has two pools in this fixture: fall back to two DIFFERENT entries within the
      // SAME pool (needs >= 2 members) — MOVE_ENTRY into its own pool is a legal same-category no-op.
      const samePool = pools.find((p) => p.entries >= 2) ?? pools[0];
      const poolUidLocal = samePool?.pool_uid ?? '';
      const [pp] = await db.query<{ id: string }>(
        `select id from pool where revision_id = $1 and pool_uid = $2`,
        [rev?.id, poolUidLocal],
      );
      const members = await db.query<{ entry_id: string }>(
        `select entry_id from pool_member where pool_id = $1 order by entry_id limit 2`,
        [pp?.id],
      );
      const entryALocal = members[0]?.entry_id ?? '';
      const entryBLocal = members[1]?.entry_id ?? entryALocal;
      return {
        revisionId: rev?.id ?? '',
        entryA: entryALocal,
        entryB: entryBLocal,
        poolAUid: poolUidLocal,
        poolBUid: poolUidLocal,
      };
    }

    beforeAll(async () => {
      db = await backend.open();
      const t = await newTournament(db);
      tournament = t.tournament;
      officer = t.officer;
      viewer = t.viewer;
      await newArena(db, tournament);
      const seeded = await seedRevision(ruleSet);
      revisionId = seeded.revisionId;
      entryA = seeded.entryA;
      entryB = seeded.entryB;
      poolAUid = seeded.poolAUid;
      poolBUid = seeded.poolBUid;
    }, 60_000);

    const moveCmd = (overrides: Partial<DrawCommand & { type: 'MOVE_ENTRY' }> = {}): DrawCommand => ({
      type: 'MOVE_ENTRY',
      revisionId,
      entryId: entryA,
      toPoolUid: poolBUid,
      toSlot: null,
      expectedLockVersion: 0,
      idempotencyKey: cmdKey(),
      reason: null,
      complaintId: null,
      ...overrides,
    });

    describe('RBAC', () => {
      it('a VIEWER cannot issue a content command', async () => {
        const out = await applyDrawCommand(db, moveCmd(), asViewer());
        expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'FORBIDDEN_COMMAND' });
      });

      it('a DRAWING_OFFICER cannot LOCK a revision', async () => {
        const out = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'LOCK',
            revisionId,
            expectedLockVersion: 0,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer(),
        );
        expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'FORBIDDEN_COMMAND' });
      });

      it('role is resolved server-side: a claimed TECHNICAL_DELEGATE role from an officer actor is not honored by the caller — the DB layer trusts only what it is given, so callers (API) must resolve it themselves', async () => {
        // Documented boundary: applyDrawCommand trusts its `actor` argument. The API layer (not
        // exercised by this DB-level test) is responsible for resolving the role from
        // tournament_member before calling this function — never from client input.
        const [row] = await db.query<{ role: string }>(
          `select role from tournament_member where tournament_id = $1 and user_id = $2`,
          [tournament, officer],
        );
        expect(row?.role).toBe('DRAWING_OFFICER');
      });
    });

    describe('idempotency', () => {
      it('a duplicate submission with the same idempotency key replays the original outcome without reapplying', async () => {
        const cmd = moveCmd();
        const first = await applyDrawCommand(db, cmd, asOfficer());
        expect(first.outcome).toBe('APPLIED');
        expect(first.replayed).toBe(false);
        const [afterFirst] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );

        const replay = await applyDrawCommand(db, cmd, asOfficer());
        expect(replay).toMatchObject({
          outcome: 'APPLIED',
          replayed: true,
          commandRowId: first.commandRowId,
        });
        const [afterReplay] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );
        expect(afterReplay?.lock_version).toBe(afterFirst?.lock_version); // not bumped again

        const count = Number(
          (
            await db.query<{ n: string }>(`select count(*) n from draw_command where idempotency_key = $1`, [
              cmd.idempotencyKey,
            ])
          )[0]?.n,
        );
        expect(count).toBe(1);
      });

      it('reusing an idempotency key for a genuinely different command is rejected, not silently replayed', async () => {
        const key = cmdKey();
        const [rv] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );
        const first = await applyDrawCommand(
          db,
          moveCmd({ idempotencyKey: key, expectedLockVersion: rv?.lock_version ?? 0 }),
          asOfficer(),
        );
        expect(first.outcome).toBe('APPLIED');
        const conflict = await applyDrawCommand(
          db,
          moveCmd({
            idempotencyKey: key,
            entryId: entryB,
            toPoolUid: poolAUid,
            expectedLockVersion: (rv?.lock_version ?? 0) + 1,
          }),
          asOfficer(),
        );
        expect(conflict).toMatchObject({
          outcome: 'REJECTED',
          rejectionCode: 'IDEMPOTENCY_CONFLICT',
          replayed: false,
        });
      });

      it('retrying after a timeout with the same key still returns the same result (no double-apply)', async () => {
        const [rv] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );
        const cmd = moveCmd({
          entryId: entryB,
          toPoolUid: poolAUid,
          expectedLockVersion: rv?.lock_version ?? 0,
        });
        const a = await applyDrawCommand(db, cmd, asOfficer());
        await new Promise((r) => setTimeout(r, 5));
        const b = await applyDrawCommand(db, cmd, asOfficer());
        expect(a.replayed).toBe(false);
        expect(b).toEqual({ ...a, replayed: true });
      });
    });

    describe('optimistic concurrency (REVISION_CONFLICT)', () => {
      it('two commands against the same revision at the same expected lock_version: exactly one applies', async () => {
        const [before] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );
        const version = before?.lock_version ?? 0;
        const cmdA = moveCmd({
          entryId: entryA,
          toPoolUid: poolBUid,
          expectedLockVersion: version,
          idempotencyKey: cmdKey(),
        });
        const cmdB = moveCmd({
          entryId: entryB,
          toPoolUid: poolAUid,
          expectedLockVersion: version,
          idempotencyKey: cmdKey(),
        });
        const [resultA, resultB] = await Promise.all([
          applyDrawCommand(db, cmdA, asOfficer()),
          applyDrawCommand(db, cmdB, asOfficer()),
        ]);
        const outcomes = [resultA.outcome, resultB.outcome].sort();
        expect(outcomes).toEqual(['APPLIED', 'REJECTED']);
        const loser = resultA.outcome === 'REJECTED' ? resultA : resultB;
        expect(loser.rejectionCode).toBe('REVISION_CONFLICT');
        const [after] = await db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where id = $1`,
          [revisionId],
        );
        expect(after?.lock_version).toBe(version + 1); // the loser's attempt did not consume a version
      });

      it('a command against a stale revision (old lock_version) is rejected, not silently merged', async () => {
        const out = await applyDrawCommand(
          db,
          moveCmd({ expectedLockVersion: 0, idempotencyKey: cmdKey() }),
          asOfficer(),
        );
        expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REVISION_CONFLICT' });
      });
    });

    describe('audit trail', () => {
      it('every applied command produces an audit event in the same (committed) transaction, hash-chained', async () => {
        const [before] = await db.query<{ n: string }>(
          `select count(*) n from audit_event where tournament_id = $1`,
          [tournament],
        );
        const cmd = moveCmd({
          expectedLockVersion:
            (
              await db.query<{ lock_version: number }>(
                `select lock_version from draw_revision where id = $1`,
                [revisionId],
              )
            )[0]?.lock_version ?? 0,
          idempotencyKey: cmdKey(),
        });
        const applied = await applyDrawCommand(db, cmd, asOfficer());
        expect(applied.outcome).toBe('APPLIED');
        const [after] = await db.query<{ n: string }>(
          `select count(*) n from audit_event where tournament_id = $1`,
          [tournament],
        );
        expect(Number(after?.n)).toBe(Number(before?.n) + 1);
        const [event] = await db.query<{ command_id: string; hash: string; prev_hash: string | null }>(
          `select command_id, hash, prev_hash from audit_event where tournament_id = $1 order by seq desc limit 1`,
          [tournament],
        );
        expect(event?.command_id).toBe(applied.commandRowId);
        expect(event?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        const [head] = await db.query<{ last_hash: string }>(
          `select last_hash from audit_chain_head where chain_key = $1`,
          [`tournament:${tournament}`],
        );
        expect(head?.last_hash).toBe(event?.hash);
      });

      it('the audit trail is append-only', async () => {
        const [event] = await db.query<{ id: string }>(
          `select id from audit_event where tournament_id = $1 limit 1`,
          [tournament],
        );
        const { dbError } = await import('./testing/test-db.js');
        expect(
          await dbError(db.query(`update audit_event set reason = 'x' where id = $1`, [event?.id])),
        ).toContain('APPEND_ONLY_VIOLATION');
        expect(await dbError(db.query(`delete from audit_event where id = $1`, [event?.id]))).toContain(
          'APPEND_ONLY_VIOLATION',
        );
      });
    });

    describe('revision lifecycle end to end, with a lockable rule set', () => {
      it('DRAFT → REVIEW (allocates match codes) → APPROVED → LOCKED → PUBLISHED → AMENDED → PUBLISHED, with stable match codes across the amendment', async () => {
        const t1 = await newTournament(db);
        await newArena(db, t1.tournament);
        const seeded = await seedRevision(lockableRuleSet(ruleSet), {
          tournamentId: t1.tournament,
          actorId: t1.officer,
        });
        const asOfficer1 = (): CommandActor => ({ userId: t1.officer, role: 'DRAWING_OFFICER' });
        const asTd1 = (): CommandActor => ({ userId: t1.td, role: 'TECHNICAL_DELEGATE' });
        const rev = seeded.revisionId;
        const act = (type: 'LIFECYCLE', action: string, expectedLockVersion: number) =>
          applyDrawCommand(
            db,
            {
              type,
              action: action as never,
              revisionId: rev,
              expectedLockVersion,
              idempotencyKey: cmdKey(),
              reason: 'lifecycle e2e test reason',
              complaintId: null,
            },
            asTd1(),
          );

        let lv = 0;
        const submit = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'SUBMIT',
            revisionId: rev,
            expectedLockVersion: lv,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer1(),
        );
        expect(submit.outcome).toBe('APPLIED');
        lv += 1;
        const codesAfterSubmit = await db.query<{ public_code: string; match_uid: string }>(
          `select public_code, match_uid from match where revision_id = $1 order by public_code`,
          [rev],
        );
        expect(codesAfterSubmit.length).toBeGreaterThan(0);
        expect(codesAfterSubmit.every((m) => /^A[0-9]{3}$/.test(m.public_code))).toBe(true);

        const approve = await act('LIFECYCLE', 'APPROVE', lv);
        expect(approve.outcome).toBe('APPLIED');
        lv += 1;
        const lock = await act('LIFECYCLE', 'LOCK', lv);
        expect(lock.outcome).toBe('APPLIED');
        lv += 1;
        const [locked] = await db.query<{ lifecycle: string; content_fingerprint: string | null }>(
          `select lifecycle, content_fingerprint from draw_revision where id = $1`,
          [rev],
        );
        expect(locked).toMatchObject({ lifecycle: 'LOCKED' });
        expect(locked?.content_fingerprint).toMatch(/^sha256:/);

        const publish = await act('LIFECYCLE', 'PUBLISH', lv);
        expect(publish.outcome).toBe('APPLIED');
        lv += 1;
        const officialCount = Number(
          (
            await db.query<{ n: string }>(
              `select count(*) n from official_category_assignment oca join pool p on p.category_id = oca.category_id and p.revision_id = $1`,
              [rev],
            )
          )[0]?.n,
        );
        expect(officialCount).toBeGreaterThan(0);

        const amend = await act('LIFECYCLE', 'AMEND', lv);
        expect(amend.outcome).toBe('APPLIED');
        const childRevisionId = amend.resultingRevisionId as string;
        expect(childRevisionId).not.toBe(rev);
        const [parentAfter] = await db.query<{ lifecycle: string }>(
          `select lifecycle from draw_revision where id = $1`,
          [rev],
        );
        expect(parentAfter?.lifecycle).toBe('AMENDED');
        const [child] = await db.query<{
          lifecycle: string;
          revision_no: number;
          parent_revision_id: string;
        }>(`select lifecycle, revision_no, parent_revision_id from draw_revision where id = $1`, [
          childRevisionId,
        ]);
        expect(child).toMatchObject({ lifecycle: 'DRAFT', revision_no: 2, parent_revision_id: rev });

        // The child's matches carry the SAME match_uid as the parent's (copy-on-write); submitting
        // it again reuses the SAME public codes rather than minting new ones (ADR-0005 stability).
        const childMatchUids = await db.query<{ match_uid: string }>(
          `select match_uid from match where revision_id = $1 order by match_uid`,
          [childRevisionId],
        );
        const parentMatchUids = await db.query<{ match_uid: string }>(
          `select match_uid from match where revision_id = $1 order by match_uid`,
          [rev],
        );
        expect(childMatchUids.map((m) => m.match_uid)).toEqual(parentMatchUids.map((m) => m.match_uid));

        const submitChild = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'SUBMIT',
            revisionId: childRevisionId,
            expectedLockVersion: 0,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer1(),
        );
        expect(submitChild.outcome).toBe('APPLIED');
        const codesAfterChildSubmit = await db.query<{ public_code: string; match_uid: string }>(
          `select public_code, match_uid from match where revision_id = $1`,
          [childRevisionId],
        );
        const originalByUid = new Map(codesAfterSubmit.map((m) => [m.match_uid, m.public_code]));
        for (const m of codesAfterChildSubmit) {
          const original = originalByUid.get(m.match_uid);
          if (original) expect(m.public_code).toBe(original);
        }
      }, 60_000);

      it('a locked/frozen revision refuses content commands', async () => {
        const t2 = await newTournament(db);
        await newArena(db, t2.tournament);
        const seeded = await seedRevision(lockableRuleSet(ruleSet), {
          tournamentId: t2.tournament,
          actorId: t2.officer,
        });
        const asOfficer2 = (): CommandActor => ({ userId: t2.officer, role: 'DRAWING_OFFICER' });
        await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'SUBMIT',
            revisionId: seeded.revisionId,
            expectedLockVersion: 0,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer2(),
        );
        const out = await applyDrawCommand(
          db,
          {
            type: 'MOVE_ENTRY',
            revisionId: seeded.revisionId,
            entryId: seeded.entryA,
            toPoolUid: seeded.poolBUid,
            toSlot: null,
            expectedLockVersion: 1,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer2(),
        );
        expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REVISION_LOCKED' });
      }, 30_000);

      it('LOCK is refused on the provisional (non-lockable) rule set with a stable code', async () => {
        const t3 = await newTournament(db);
        await newArena(db, t3.tournament);
        const seeded = await seedRevision(ruleSet, { tournamentId: t3.tournament, actorId: t3.officer });
        const asOfficer3 = (): CommandActor => ({ userId: t3.officer, role: 'DRAWING_OFFICER' });
        const asTd3 = (): CommandActor => ({ userId: t3.td, role: 'TECHNICAL_DELEGATE' });
        await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'SUBMIT',
            revisionId: seeded.revisionId,
            expectedLockVersion: 0,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asOfficer3(),
        );
        await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'APPROVE',
            revisionId: seeded.revisionId,
            expectedLockVersion: 1,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asTd3(),
        );
        const lock = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: 'LOCK',
            revisionId: seeded.revisionId,
            expectedLockVersion: 2,
            idempotencyKey: cmdKey(),
            reason: null,
            complaintId: null,
          },
          asTd3(),
        );
        expect(lock).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'RULE_SET_NOT_READY' });
      }, 30_000);
    });
  });
}
