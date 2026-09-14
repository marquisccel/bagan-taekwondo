import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, runDraw, type EngineOutput } from '@bagantkd/draw-engine';
import { runIntake, type SnapshotEntry } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimQueuedDrawRun,
  createDrawRun,
  executeDrawRun,
  failStuckDrawRun,
  findStaleQueuedRuns,
  findStuckRunningDrawRuns,
} from './draw-run-repository.js';
import { persistIntake } from './intake-repository.js';
import { persistRuleSet } from './rule-set-repository.js';
import { newArena, newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { dbError, testBackends, type TestDb } from './testing/test-db.js';

/**
 * Phase 4 — DrawRun persistence: the frozen engine's output, persisted transactionally and
 * reloaded, must be semantically identical to calling the engine directly (ACCEPTANCE §Phase 4).
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

for (const backend of testBackends()) {
  describe(`draw run persistence — ${backend.name}`, () => {
    let db: TestDb;
    let tournament: string;
    let officer: string;
    let ruleSetId: string;
    let snapshotId: string;
    let readyScope: string[];
    let expected: EngineOutput;
    let drawRunId: string;
    let entryByEngineId: Map<string, SnapshotEntry>;

    beforeAll(async () => {
      db = await backend.open();
      const t = await newTournament(db);
      tournament = t.tournament;
      officer = t.officer;
      await newArena(db, tournament);
      const persistedRs = await db.transaction((tx) =>
        persistRuleSet(tx, { tournamentId: tournament, actorId: officer, ruleSet }),
      );
      ruleSetId = persistedRs.ruleSetId;

      const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet });
      if (!intake.snapshot) throw new Error('intake produced no snapshot');
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
      entryByEngineId = new Map(intake.snapshot.entries.map((e) => [e.entryId, e]));

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
      expected = runDraw({
        engineVersion: ENGINE_VERSION,
        purpose: 'CANDIDATE',
        seed: parseDrawSeed('20260827'),
        ruleSet,
        entries: intake.snapshot.entries,
        scope: readyScope,
        assumptions: null,
      });
      expect(expected.status).toBe('SAFE');

      const created = await db.transaction((tx) =>
        createDrawRun(tx, {
          tournamentId: tournament,
          ruleSetId,
          ruleSetSnapshot: ruleSet,
          ruleSetFingerprint: persistedRs.fingerprint,
          intakeSnapshotId: snapshotId,
          intakeEntries: intake.snapshot?.entries ?? [],
          kind: 'CANDIDATE',
          seed: '20260827',
          scope: readyScope,
          assumptions: null,
          requestedBy: officer,
        }),
      );
      drawRunId = created.drawRunId;
      expect(created.inputFingerprint).toBe(expected.fingerprints.input);
    });
    afterAll(async () => db.close());

    it('createDrawRun writes an immutable QUEUED row with the exact fingerprint the engine will produce', async () => {
      const [row] = await db.query<{ status: string; input_fingerprint: string; kind: string }>(
        'select status, input_fingerprint, kind from draw_run where id = $1',
        [drawRunId],
      );
      expect(row).toEqual({
        status: 'QUEUED',
        input_fingerprint: expected.fingerprints.input,
        kind: 'CANDIDATE',
      });
    });

    it('executeDrawRun persists a result semantically identical to the direct engine call, and running it twice more (dual run) matches', async () => {
      const result = await executeDrawRun(db, drawRunId);
      expect(result.claimed).toBe(true);
      expect(result.output?.fingerprints.output).toBe(expected.fingerprints.output);

      const [run] = await db.query<{
        status: string;
        output_fingerprint: string;
        dual_run_match: boolean;
        rules_fingerprint: string;
      }>('select status, output_fingerprint, dual_run_match, rules_fingerprint from draw_run where id = $1', [
        drawRunId,
      ]);
      expect(run).toEqual({
        status: 'SAFE',
        output_fingerprint: expected.fingerprints.output,
        dual_run_match: true,
        rules_fingerprint: expected.fingerprints.rules,
      });

      const expectedPools = expected.categories.flatMap((c) => c.pools);
      const expectedMatches = expectedPools.flatMap((p) => p.bracket.matches);
      const counts = async (sql: string) => Number((await db.query<{ n: string }>(sql, [drawRunId]))[0]?.n);
      expect(
        await counts(
          `select count(*) n from category c join draw_run_category rc on rc.category_id = c.id where rc.draw_run_id = $1`,
        ),
      ).toBe(expected.categories.length);
      expect(await counts(`select count(*) n from pool_candidate where draw_run_id = $1`)).toBe(
        expected.categories.reduce((s, c) => s + c.candidates.length, 0),
      );
      expect(
        await counts(
          `select count(*) n from pool p join draw_revision v on v.id = p.revision_id where v.draw_run_id = $1`,
        ),
      ).toBe(expectedPools.length);
      expect(
        await counts(
          `select count(*) n from match m join draw_revision v on v.id = m.revision_id where v.draw_run_id = $1`,
        ),
      ).toBe(expectedMatches.length);
      expect(
        await counts(
          `select count(*) n from bracket_slot s join bracket b on b.id = s.bracket_id join pool p on p.id = b.pool_id join draw_revision v on v.id = p.revision_id where v.draw_run_id = $1`,
        ),
      ).toBe(expectedPools.reduce((s, p) => s + p.bracket.slots.length, 0));

      const [revision] = await db.query<{
        revision_no: number;
        lifecycle: string;
        lock_version: number;
        parent_revision_id: string | null;
      }>(
        `select revision_no, lifecycle, lock_version, parent_revision_id from draw_revision where draw_run_id = $1`,
        [drawRunId],
      );
      expect(revision).toEqual({
        revision_no: 1,
        lifecycle: 'DRAFT',
        lock_version: 0,
        parent_revision_id: null,
      });
    });

    it('reload equals the engine output: every pool member, bracket slot and match feeder round-trips', async () => {
      const [revision] = await db.query<{ id: string }>(
        `select id from draw_revision where draw_run_id = $1`,
        [drawRunId],
      );
      const revisionId = revision?.id ?? '';
      for (const c of expected.categories.filter((x) => x.readiness === 'READY')) {
        for (const p of c.pools) {
          const [poolRow] = await db.query<{ id: string; is_walkover: boolean }>(
            `select id, is_walkover from pool where revision_id = $1 and pool_uid = $2`,
            [revisionId, p.poolUid],
          );
          expect(poolRow, p.poolUid).toBeDefined();
          expect(poolRow?.is_walkover).toBe(p.isWalkover);
          const members = await db.query<{ external_ref: string }>(
            `select e.external_ref from pool_member pm join entry e on e.id = pm.entry_id where pm.pool_id = $1`,
            [poolRow?.id],
          );
          const expectedRefs = p.entryIds.map((id) => entryByEngineId.get(id)?.externalRef ?? '').sort();
          expect(members.map((m) => m.external_ref).sort()).toEqual(expectedRefs);
          const [bracket] = await db.query<{
            id: string;
            size: number;
            rounds: number;
            entries: number;
            byes: number;
          }>(`select id, size, rounds, entries, byes from bracket where pool_id = $1`, [poolRow?.id]);
          expect(bracket).toMatchObject({
            size: p.bracket.size,
            rounds: p.bracket.rounds,
            entries: p.bracket.entries,
            byes: p.bracket.byes,
          });
          const matchCount = Number(
            (
              await db.query<{ n: string }>(`select count(*) n from match where bracket_id = $1`, [
                bracket?.id,
              ])
            )[0]?.n,
          );
          expect(matchCount).toBe(p.bracket.matches.length);
        }
      }
    });

    it('worker-restart safe: executing an already-finished run again is a no-op (claimed: false)', async () => {
      const again = await executeDrawRun(db, drawRunId);
      expect(again.claimed).toBe(false);
      const [row] = await db.query<{ status: string }>('select status from draw_run where id = $1', [
        drawRunId,
      ]);
      expect(row?.status).toBe('SAFE');
    });

    it('a finished draw_run is immutable at the database level', async () => {
      expect(
        await dbError(db.query(`update draw_run set status = 'QUEUED' where id = $1`, [drawRunId])),
      ).toContain('DRAW_RUN_IMMUTABLE');
      expect(await dbError(db.query(`delete from draw_run where id = $1`, [drawRunId]))).toContain(
        'DRAW_RUN_IMMUTABLE',
      );
    });

    it('reconciliation: finds stale QUEUED runs and stuck RUNNING runs, ignoring finished ones', async () => {
      expect(await findStaleQueuedRuns(db, 0)).toEqual([]);
      expect(await findStuckRunningDrawRuns(db, 0)).toEqual([]);
      const orphan = await db.transaction((tx) =>
        createDrawRun(tx, {
          tournamentId: tournament,
          ruleSetId,
          ruleSetSnapshot: ruleSet,
          ruleSetFingerprint: expected.fingerprints.rules,
          intakeSnapshotId: snapshotId,
          intakeEntries: [],
          kind: 'SIMULATION',
          seed: '1',
          scope: [],
          assumptions: null,
          requestedBy: officer,
        }),
      );
      // requested_at is part of the immutable identity tuple (draw_run_guard); simulate the
      // passage of time the only legitimate way a test can, by disabling the trigger briefly.
      await db.query(`alter table draw_run disable trigger draw_run_guard`);
      try {
        await db.query(`update draw_run set requested_at = now() - interval '1 hour' where id = $1`, [
          orphan.drawRunId,
        ]);
      } finally {
        await db.query(`alter table draw_run enable trigger draw_run_guard`);
      }
      expect(await findStaleQueuedRuns(db, 1000)).toContain(orphan.drawRunId);
      const claimed = await claimQueuedDrawRun(db, orphan.drawRunId);
      expect(claimed).not.toBeNull();
      await db.query(`update draw_run set started_at = now() - interval '1 hour' where id = $1`, [
        orphan.drawRunId,
      ]);
      expect(await findStuckRunningDrawRuns(db, 1000)).toContain(orphan.drawRunId);
      // A second claim attempt (simulating a competing worker or a retry) is a safe no-op.
      expect(await claimQueuedDrawRun(db, orphan.drawRunId)).toBeNull();
      // RUNNING can never revert to QUEUED (draw_run_guard); the only safe closure for a stuck
      // run is FAILED with a stable reason. Two racing reconcilers: exactly one wins.
      const [a, b] = await Promise.all([
        failStuckDrawRun(db, orphan.drawRunId, 'reconciliation sweep'),
        failStuckDrawRun(db, orphan.drawRunId, 'reconciliation sweep'),
      ]);
      expect([a, b].sort()).toEqual([false, true]);
      const [row] = await db.query<{ status: string; unsafe_reasons: unknown }>(
        `select status, unsafe_reasons from draw_run where id = $1`,
        [orphan.drawRunId],
      );
      expect(row?.status).toBe('FAILED');
      expect(row?.unsafe_reasons).toMatchObject([{ code: 'WORKER_TIMEOUT' }]);
      expect(await findStuckRunningDrawRuns(db, 0)).not.toContain(orphan.drawRunId);
    });
  });
}
