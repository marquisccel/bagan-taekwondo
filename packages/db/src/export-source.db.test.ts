import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, runDraw, type EngineOutput } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDrawRun, executeDrawRun } from './draw-run-repository.js';
import { loadExportModel } from './export-source.js';
import { persistIntake } from './intake-repository.js';
import { persistRuleSet } from './rule-set-repository.js';
import { newArena, newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * Phase 6 — export-source: `loadExportModel` reads a real persisted revision (via the same
 * intake -> draw -> persist pipeline draw-run.db.test.ts proves) and must map it onto the
 * ExportModel exactly, with no NIK, and deterministically across repeated reads.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

for (const backend of testBackends()) {
  describe(`export-source (loadExportModel) — ${backend.name}`, () => {
    let db: TestDb;
    let revisionId: string;
    let expected: EngineOutput;

    beforeAll(async () => {
      db = await backend.open();
      const t = await newTournament(db);
      await newArena(db, t.tournament);
      const persistedRs = await db.transaction((tx) =>
        persistRuleSet(tx, { tournamentId: t.tournament, actorId: t.officer, ruleSet }),
      );

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
      const [revision] = await db.query<{ id: string }>(
        `select id from draw_revision where draw_run_id = $1`,
        [created.drawRunId],
      );
      revisionId = revision?.id ?? '';
    });
    afterAll(async () => db.close());

    it('maps every READY category, its pools, its bracket size/rounds/byes exactly onto the engine output', async () => {
      const model = await loadExportModel(db, revisionId);
      const readyCategories = expected.categories.filter((c) => c.readiness === 'READY');
      expect(model.categories).toHaveLength(readyCategories.length);

      for (const ec of readyCategories) {
        const mc = model.categories.find((c) => c.categoryKey === ec.categoryKey);
        expect(mc, ec.categoryKey).toBeDefined();
        expect(mc?.pools).toHaveLength(ec.pools.length);
        for (const ep of ec.pools) {
          const mp = mc?.pools.find((p) => p.poolUid === ep.poolUid);
          expect(mp, ep.poolUid).toBeDefined();
          expect(mp?.members).toHaveLength(ep.entryIds.length);
          if (mp?.bracket) {
            expect(mp.bracket).toMatchObject({
              size: ep.bracket.size,
              rounds: ep.bracket.rounds,
              entries: ep.bracket.entries,
              byes: ep.bracket.byes,
            });
            expect(mp.bracket.matches).toHaveLength(ep.bracket.matches.length);
          }
        }
      }
    });

    it('never includes NIK anywhere in the model (no ciphertext/blind-index fields, no 16-digit NIK-shaped values)', async () => {
      const model = await loadExportModel(db, revisionId);
      const json = JSON.stringify(model);
      expect(json.toLowerCase()).not.toContain('nik_ciphertext');
      expect(json.toLowerCase()).not.toContain('nik_blind_index');
      expect(json).not.toMatch(/"\d{16}"/);
    });

    it('is deterministic: reading the same revision twice produces a deeply equal model', async () => {
      const [a, b] = await Promise.all([loadExportModel(db, revisionId), loadExportModel(db, revisionId)]);
      expect(a).toEqual(b);
    });
  });
}
