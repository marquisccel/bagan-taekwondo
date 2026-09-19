import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { applyDrawCommand, type CommandActor } from './command-repository.js';
import { lockableRuleSet, provisionalRuleSet, seedDrawnRevision } from './testing/seed-revision.js';
import { newArena, newTournament } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * AUD-006: publishing the replacement of an amended revision retires its parent through the
 * existing SUPERSEDE transition — lineage, audit history, artifact references and match codes stay.
 */
for (const backend of testBackends()) {
  describe(`amend → publish replacement → parent SUPERSEDED (AUD-006) — ${backend.name}`, () => {
    let db: TestDb;
    beforeAll(async () => {
      db = await backend.open();
    }, 60_000);

    it('B is the current PUBLISHED revision, A is SUPERSEDED, and the history stays queryable', async () => {
      const t = await newTournament(db);
      await newArena(db, t.tournament);
      const { revisionId: a, drawRunId } = await seedDrawnRevision(
        db,
        { tournamentId: t.tournament, actorId: t.officer },
        lockableRuleSet(provisionalRuleSet),
      );
      const officer: CommandActor = { userId: t.officer, role: 'DRAWING_OFFICER' };
      const td: CommandActor = { userId: t.td, role: 'TECHNICAL_DELEGATE' };
      const lifecycle = async (revisionId: string, action: string, actor: CommandActor, lv: number) => {
        const out = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action: action as never,
            revisionId,
            expectedLockVersion: lv,
            idempotencyKey: randomUUID(),
            reason: `uji ${action}`,
            complaintId: null,
          },
          actor,
        );
        expect(out.outcome, `${action} ${JSON.stringify(out.verdict)}`).toBe('APPLIED');
        return out;
      };
      const state = async (id: string) =>
        (
          await db.query<{ lifecycle: string; lock_version: number }>(
            `select lifecycle, lock_version from draw_revision where id = $1`,
            [id],
          )
        )[0];
      const publishThrough = async (id: string) => {
        await lifecycle(id, 'SUBMIT', officer, 0);
        await lifecycle(id, 'APPROVE', td, 1);
        await lifecycle(id, 'LOCK', td, 2);
        await lifecycle(id, 'PUBLISH', td, 3);
      };

      await publishThrough(a);
      expect((await state(a))?.lifecycle).toBe('PUBLISHED');
      const codesA = await db.query<{ match_uid: string; public_code: string }>(
        `select match_uid, public_code from match where revision_id = $1 order by match_uid`,
        [a],
      );
      const poolsA = await db.query<{ n: number }>(
        `select count(*)::int n from pool where revision_id = $1`,
        [a],
      );

      // amend -> child B (DRAFT); the parent is AMENDED, not yet superseded
      const amend = await lifecycle(a, 'AMEND', td, (await state(a))?.lock_version ?? -1);
      const b = amend.resultingRevisionId as string;
      expect((await state(a))?.lifecycle).toBe('AMENDED');

      await publishThrough(b);
      expect((await state(b))?.lifecycle).toBe('PUBLISHED');
      expect((await state(a))?.lifecycle).toBe('SUPERSEDED');

      // revision history remains queryable, lineage intact
      const history = await db.query<{
        revision_no: number;
        lifecycle: string;
        parent_revision_id: string | null;
      }>(
        `select revision_no, lifecycle, parent_revision_id from draw_revision where draw_run_id = $1 order by revision_no`,
        [drawRunId],
      );
      expect(history).toEqual([
        { revision_no: 1, lifecycle: 'SUPERSEDED', parent_revision_id: null },
        { revision_no: 2, lifecycle: 'PUBLISHED', parent_revision_id: a },
      ]);
      // the superseded revision's content is untouched (published artifacts keep pointing at it)
      expect(
        await db.query(`select match_uid, public_code from match where revision_id = $1 order by match_uid`, [
          a,
        ]),
      ).toEqual(codesA);
      expect(await db.query(`select count(*)::int n from pool where revision_id = $1`, [a])).toEqual(poolsA);
      // match codes are stable across the amendment (ADR-0005)
      const codesB = await db.query<{ match_uid: string; public_code: string }>(
        `select match_uid, public_code from match where revision_id = $1 order by match_uid`,
        [b],
      );
      expect(codesB).toEqual(codesA);
      // the official assignment moved to B; only B is official
      const official = await db.query<{ revision_id: string }>(
        `select distinct revision_id from official_category_assignment oca
         where oca.category_id in (select category_id from pool where revision_id = $1)`,
        [b],
      );
      expect(official).toEqual([{ revision_id: b }]);
      // audit: the SUPERSEDE is on the trail, on the parent, after the publish that caused it
      const events = await db.query<{ action: string; subject_id: string; after: { supersededBy?: string } }>(
        `select action, subject_id, after from audit_event where tournament_id = $1 and action in ('LIFECYCLE_PUBLISH','LIFECYCLE_SUPERSEDE') order by seq`,
        [t.tournament],
      );
      expect(events.map((e) => e.action)).toEqual([
        'LIFECYCLE_PUBLISH',
        'LIFECYCLE_PUBLISH',
        'LIFECYCLE_SUPERSEDE',
      ]);
      expect(events[2]).toMatchObject({ subject_id: a, after: { supersededBy: b } });

      // a SUPERSEDED revision is terminal: it accepts nothing further
      const again = await applyDrawCommand(
        db,
        {
          type: 'LIFECYCLE',
          action: 'AMEND',
          revisionId: a,
          expectedLockVersion: (await state(a))?.lock_version ?? -1,
          idempotencyKey: randomUUID(),
          reason: 'x',
          complaintId: null,
        },
        td,
      );
      expect(again).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'INVALID_COMMAND' });

      // a second amendment supersedes B in turn; A stays SUPERSEDED
      const amend2 = await lifecycle(b, 'AMEND', td, (await state(b))?.lock_version ?? -1);
      const c = amend2.resultingRevisionId as string;
      await publishThrough(c);
      expect([(await state(a))?.lifecycle, (await state(b))?.lifecycle, (await state(c))?.lifecycle]).toEqual(
        ['SUPERSEDED', 'SUPERSEDED', 'PUBLISHED'],
      );
    }, 120_000);

    it('a PUBLISH of a revision that is not an amendment supersedes nothing', async () => {
      const t = await newTournament(db);
      await newArena(db, t.tournament);
      const { revisionId } = await seedDrawnRevision(
        db,
        { tournamentId: t.tournament, actorId: t.officer },
        lockableRuleSet(provisionalRuleSet),
      );
      const officer: CommandActor = { userId: t.officer, role: 'DRAWING_OFFICER' };
      const td: CommandActor = { userId: t.td, role: 'TECHNICAL_DELEGATE' };
      let lv = 0;
      for (const [action, actor] of [
        ['SUBMIT', officer],
        ['APPROVE', td],
        ['LOCK', td],
        ['PUBLISH', td],
      ] as const) {
        const out = await applyDrawCommand(
          db,
          {
            type: 'LIFECYCLE',
            action,
            revisionId,
            expectedLockVersion: lv,
            idempotencyKey: randomUUID(),
            reason: null,
            complaintId: null,
          },
          actor,
        );
        expect(out.outcome).toBe('APPLIED');
        lv += 1;
      }
      const [n] = await db.query<{ n: number }>(
        `select count(*)::int n from audit_event where tournament_id = $1 and action = 'LIFECYCLE_SUPERSEDE'`,
        [t.tournament],
      );
      expect(n?.n).toBe(0);
    }, 120_000);
  });
}
