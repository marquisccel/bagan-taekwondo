import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION } from './contract.js';
import { runDraw } from './run.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const datasetPath = root('data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv');
const available = existsSync(datasetPath);

describe.skipIf(!available)('golden 2026: engine stages 1–4 on the real intake snapshot', () => {
  it('re-derives all 238 categories with no disagreement; a full-scope draw is refused for blocked categories', () => {
    const ruleSet = JSON.parse(
      readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
    ) as RuleSet;
    const intake = runIntake({ sourceName: 'REAL_2026', bytes: readFileSync(datasetPath), ruleSet });
    if (!intake.snapshot) throw new Error('no snapshot');
    const out = runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION',
      seed: parseDrawSeed('20260827'),
      ruleSet,
      entries: intake.snapshot.entries,
      scope: [],
      assumptions: null,
    });
    // Acceptance values (ACCEPTANCE_CRITERIA §5), test-only.
    expect(out.quality.metrics).toMatchObject({
      entries: 3115,
      entriesMalformed: 0,
      intakeDisagreements: 0,
      categoryKeyMismatches: 0,
      categories: 238,
      entriesWithheld: 49,
      entriesEligible: 3115 - 49,
    });
    const byTemplate: Record<string, number> = {};
    for (const c of out.categories) byTemplate[c.templateCode] = (byTemplate[c.templateCode] ?? 0) + 1;
    expect(byTemplate['KYORUGI_PRESTASI']).toBe(71);
    expect(byTemplate['KYORUGI_SEMI_PRESTASI']).toBe(105);
    expect(byTemplate['POOMSAE_SEMI_PRESTASI']).toBe(36);
    expect((byTemplate['FREESTYLE_INDIVIDUAL'] ?? 0) + (byTemplate['FREESTYLE_PAIR'] ?? 0)).toBe(9);
    expect(out.status).toBe('UNSAFE');
    expect(out.unsafeReasons.map((r) => r.code)).toEqual(['CATEGORY_BLOCKED']);
  });
});
