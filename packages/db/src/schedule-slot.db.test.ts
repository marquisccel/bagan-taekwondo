import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, runDraw, type EngineOutput } from '@bagantkd/draw-engine';
import { runIntake, type SnapshotEntry } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { categoryKeyDims, parseDrawSeed } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDrawRun, executeDrawRun } from './draw-run-repository.js';
import { loadScheduleSlotForDrawRun } from './export-source.js';
import { persistIntake } from './intake-repository.js';
import { persistRuleSet } from './rule-set-repository.js';
import { newArena, newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * `loadScheduleSlotForDrawRun` infers which "Jadwal FIX" arena/day slot (schedule_entry) a draw
 * run's categories belong to, since draw_run itself never stores that link -- see the comment on
 * the function. Real intake/draw pipeline, same as export-source.db.test.ts, plus a hand-inserted
 * schedule_entry row matching one of the run's own READY categories.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

for (const backend of testBackends()) {
  describe(`loadScheduleSlotForDrawRun — ${backend.name}`, () => {
    let db: TestDb;
    let tournamentId: string;
    let officerId: string;
    let ruleSetId: string;
    let ruleSetFingerprint: string;
    let intakeSnapshotId: string;
    let intakeEntries: readonly SnapshotEntry[];
    let drawRunId: string;
    let expected: EngineOutput;

    beforeAll(async () => {
      db = await backend.open();
      const t = await newTournament(db);
      tournamentId = t.tournament;
      officerId = t.officer;
      await newArena(db, t.tournament, 'A');
      const persistedRs = await db.transaction((tx) =>
        persistRuleSet(tx, { tournamentId: t.tournament, actorId: t.officer, ruleSet }),
      );
      ruleSetId = persistedRs.ruleSetId;
      ruleSetFingerprint = persistedRs.fingerprint;

      const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet });
      if (!intake.snapshot) throw new Error('intake produced no snapshot');
      const saved = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: t.tournament,
          ruleSetId: persistedRs.ruleSetId,
          actorId: t.officer,
          result: intake,
          nikKeys: TEST_NIK_KEYS,
          mode: 'INITIAL',
        }),
      );
      intakeSnapshotId = saved.snapshotId;
      intakeEntries = intake.snapshot.entries;

      const plan = runDraw({
        engineVersion: ENGINE_VERSION,
        purpose: 'CANDIDATE',
        seed: parseDrawSeed('20260827'),
        ruleSet,
        entries: intake.snapshot.entries,
        scope: [],
        assumptions: null,
      });
      const readyScope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
      expect(readyScope.length).toBeGreaterThan(0);
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
          tournamentId: t.tournament,
          ruleSetId: persistedRs.ruleSetId,
          ruleSetSnapshot: ruleSet,
          ruleSetFingerprint: persistedRs.fingerprint,
          intakeSnapshotId: saved.snapshotId,
          intakeEntries: intake.snapshot?.entries ?? [],
          kind: 'CANDIDATE',
          seed: '20260827',
          scope: readyScope,
          assumptions: null,
          requestedBy: t.officer,
        }),
      );
      await executeDrawRun(db, created.drawRunId);
      drawRunId = created.drawRunId;
    });
    afterAll(async () => db.close());

    it('returns null for a draw run whose categories are not scheduled anywhere', async () => {
      const slot = await loadScheduleSlotForDrawRun(db, tournamentId, drawRunId);
      expect(slot).toBeNull();
    });

    it('finds the arena/day slot once one of the run\'s categories is scheduled there, in the sheet\'s own row order', async () => {
      const ready = expected.categories.filter((c) => c.readiness === 'READY');
      const first = ready[0];
      const second = ready[1];
      if (!first || !second) throw new Error('need at least 2 READY categories for this fixture');

      const insertSlotRow = (cat: (typeof ready)[number], order: number) => {
        const dims = categoryKeyDims(cat.categoryKey);
        return db.query(
          `insert into schedule_entry (tournament_id, day_number, date, arena_id, order_index, stream, discipline, gender, age_division_code, weight_class_or_format)
           values ($1, 1, '2026-09-18', (select id from arena where tournament_id = $1 and code = 'A'), $2, $3, $4, $5, $6, $7)`,
          [
            tournamentId,
            order,
            dims.get('STREAM'),
            dims.get('DISCIPLINE'),
            dims.get('GENDER'),
            dims.get('AGE_DIVISION') ?? '',
            dims.get('WEIGHT_CLASS') ?? dims.get('FORMAT') ?? '',
          ],
        );
      };
      await insertSlotRow(first, 0);
      await insertSlotRow(second, 1);

      const slot = await loadScheduleSlotForDrawRun(db, tournamentId, drawRunId);
      expect(slot).not.toBeNull();
      expect(slot?.dayNumber).toBe(1);
      expect(slot?.arena).toBe('ARENA A');
      expect(slot?.dayLabel).toContain('2026');
      expect(slot?.categories).toHaveLength(2);

      const firstDims = categoryKeyDims(first.categoryKey);
      expect(slot?.categories[0]).toMatchObject({
        discipline: firstDims.get('DISCIPLINE'),
        gender: firstDims.get('GENDER'),
        ageDivisionCode: firstDims.get('AGE_DIVISION') ?? null,
      });
    });

    it('still finds the slot when the sheet\'s own weight-class cell is not yet canonical -- a Unicode minus or a spreadsheet "=+NN" leftover, exactly as the real "Jadwal FIX" tab writes it (never normalized at SPS import, unlike a category\'s own WEIGHT_CLASS dimension)', async () => {
      const ready = expected.categories.filter((c) => c.readiness === 'READY');
      // Excludes the categories the previous test already scheduled (day 1): reusing one of those
      // would give this category TWO schedule_entry candidates (the earlier canonical one and this
      // test's non-canonical one), and the canonical one would win the search first -- masking
      // exactly the bug this test exists to catch.
      const alreadyScheduled = new Set([ready[0]?.categoryKey, ready[1]?.categoryKey]);
      const kyorugiWithWeight = ready.find(
        (c) => !alreadyScheduled.has(c.categoryKey) && /\|WEIGHT_CLASS=[-+]\d+(\||$)/.test(c.categoryKey),
      );
      if (!kyorugiWithWeight) throw new Error('need a 3rd+ Kyorugi category with a weight class for this fixture');
      const dims = categoryKeyDims(kyorugiWithWeight.categoryKey);
      const canonical = dims.get('WEIGHT_CLASS') ?? '';
      const sign = canonical[0];
      const digits = canonical.slice(1);
      // The sheet's own raw text: a Unicode minus (U+2212) instead of a plain hyphen when the sign
      // is "-", or a spreadsheet "=+NN" formula leftover when it's "+" -- both handled by the same
      // `parseWeightClass` the real intake pipeline uses, never a plain string match.
      const rawSheetText = sign === '-' ? `${String.fromCharCode(0x2212)}${digits}` : `=+${digits}`;

      await db.query(
        `insert into schedule_entry (tournament_id, day_number, date, arena_id, order_index, stream, discipline, gender, age_division_code, weight_class_or_format)
         values ($1, 9, '2026-09-25', (select id from arena where tournament_id = $1 and code = 'A'), 0, $2, $3, $4, $5, $6)`,
        [
          tournamentId,
          dims.get('STREAM'),
          dims.get('DISCIPLINE'),
          dims.get('GENDER'),
          dims.get('AGE_DIVISION') ?? '',
          rawSheetText,
        ],
      );

      // A fresh draw run scoped to ONLY this one category, so the search has exactly one candidate
      // to resolve -- no ambiguity from the other tests' own schedule_entry rows.
      const soloRun = await db.transaction((tx) =>
        createDrawRun(tx, {
          tournamentId,
          ruleSetId,
          ruleSetSnapshot: ruleSet,
          ruleSetFingerprint,
          intakeSnapshotId,
          intakeEntries,
          kind: 'CANDIDATE',
          seed: '999999',
          scope: [kyorugiWithWeight.categoryKey],
          assumptions: null,
          requestedBy: officerId,
        }),
      );
      await executeDrawRun(db, soloRun.drawRunId);

      const slot = await loadScheduleSlotForDrawRun(db, tournamentId, soloRun.drawRunId);
      expect(slot).not.toBeNull();
      expect(slot?.dayNumber).toBe(9);
      expect(slot?.categories).toHaveLength(1);
      expect(slot?.categories[0]?.weightClassCode).toBe(canonical);
    });
  });
}
