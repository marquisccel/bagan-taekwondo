import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { canonicalJson } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSnapshot, persistIntake, verifyBatchContent } from './intake-repository.js';
import { newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * E6 — golden persistence: the real 2026 intake persists into every backend in one transaction,
 * with counts equal to the acceptance values (ACCEPTANCE_CRITERIA §5; numbers are test-only).
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const datasetPath = root('data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv');
const available = existsSync(datasetPath);
if (!available)
  process.stdout.write('\n  [golden-db] SKIPPED: private 2026 dataset not found (see data/README.md)\n');

for (const backend of testBackends()) {
  describe.skipIf(!available)(`golden persistence 2026 — ${backend.name}`, () => {
    let db: TestDb;
    beforeAll(async () => {
      db = await backend.open();
    });
    afterAll(async () => db?.close());

    it('persists 3,154 rows → 3,121 athletes → 3,115 entries → 28 groups with a verified snapshot', async () => {
      const ruleSet = JSON.parse(
        readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
      ) as RuleSet;
      const result = runIntake({ sourceName: 'REAL_2026', bytes: readFileSync(datasetPath), ruleSet });
      const t = await newTournament(db);
      const started = performance.now();
      const saved = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: t.tournament,
          ruleSetId: t.ruleSet,
          actorId: t.officer,
          result,
          nikKeys: TEST_NIK_KEYS,
          mode: 'INITIAL',
        }),
      );
      const ms = Math.round(performance.now() - started);
      process.stdout.write(
        `  [golden-db] ${backend.name}: persisted in ${ms} ms ${JSON.stringify(saved.counts)}\n`,
      );

      const n = async (sql: string, params: unknown[]) =>
        Number((await db.query<{ n: string }>(sql, params))[0]?.n);
      expect(await n('select count(*) n from import_row where batch_id = $1', [saved.batchId])).toBe(3154);
      expect(await n('select count(*) n from athlete where tournament_id = $1', [t.tournament])).toBe(3121);
      expect(await n('select count(*) n from entry where tournament_id = $1', [t.tournament])).toBe(3115);
      expect(
        await n(`select count(*) n from entry where tournament_id = $1 and declared_format = 'PAIR'`, [
          t.tournament,
        ]),
      ).toBe(17);
      expect(
        await n(`select count(*) n from entry where tournament_id = $1 and declared_format = 'TEAM'`, [
          t.tournament,
        ]),
      ).toBe(11);
      expect(
        await n(
          `select count(*) n from entry_group g join entry e on e.id = g.entry_id where e.tournament_id = $1 and g.source = 'HEURISTIC' and g.status = 'PROPOSED' and g.confidence = 'HIGH'`,
          [t.tournament],
        ),
      ).toBe(28);
      expect(
        await n(`select count(*) n from entry where tournament_id = $1 and eligibility_status = 'BLOCKED'`, [
          t.tournament,
        ]),
      ).toBe(49);
      expect(
        await n(
          `select count(*) n from entry where tournament_id = $1 and eligibility_status = 'BLOCKED' and declared_stream = 'SEMI_PRESTASI'`,
          [t.tournament],
        ),
      ).toBe(21);
      expect(await n('select count(*) n from validation_issue where batch_id = $1', [saved.batchId])).toBe(
        result.issues.length,
      );
      expect(
        await n(
          `select count(*) n from athlete where tournament_id = $1 and nik_ciphertext is not null and nik_blind_index is not null`,
          [t.tournament],
        ),
      ).toBe(3121);
      expect(
        await n(`select count(*) n from field_transformation where batch_id = $1`, [saved.batchId]),
      ).toBe(saved.counts.fieldTransformations);

      expect(await verifyBatchContent(db, saved.batchId)).toBe(true);
      const loaded = await loadSnapshot(db, saved.snapshotId);
      expect(loaded.fingerprint).toBe(result.snapshotFingerprint);
      expect(canonicalJson(loaded.snapshot)).toBe(canonicalJson(result.snapshot));
      expect(loaded.snapshot.entries).toHaveLength(3115);
    });
  });
}
