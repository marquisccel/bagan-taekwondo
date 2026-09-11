import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed, sha256Hex } from '@bagantkd/shared';
import { describe, expect, it } from 'vitest';

import { compareToBaseline, type Baseline } from './baseline.js';
import { parseCsv } from './csv.js';
import { simulate } from './simulate.js';
import { defaultSyntheticOptions, generateSyntheticCsv, SOURCE_COLUMNS } from './synthetic.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const baseline = JSON.parse(
  readFileSync(root('fixtures/baselines/committee-2026.json'), 'utf-8'),
) as Baseline;
const manifest = JSON.parse(readFileSync(root('fixtures/datasets/manifest.json'), 'utf-8')) as {
  datasets: Record<string, { sha256: string | null; entries?: number; seed?: string }>;
  goldenSeed: string;
  robustnessSeeds: string[];
};

describe('synthetic datasets', () => {
  it('are byte-identical for the same seed and differ for another seed', () => {
    const a = generateSyntheticCsv(ruleSet, defaultSyntheticOptions(500, '7'));
    expect(generateSyntheticCsv(ruleSet, defaultSyntheticOptions(500, '7'))).toBe(a);
    expect(generateSyntheticCsv(ruleSet, defaultSyntheticOptions(500, '8'))).not.toBe(a);
  });

  it('use the 2026 export layout, exact row count, and no trailing newline', () => {
    const csv = generateSyntheticCsv(ruleSet, defaultSyntheticOptions(1000, '3'));
    const t = parseCsv(csv);
    expect(t.header).toEqual([...SOURCE_COLUMNS]);
    expect(t.rows).toHaveLength(1000);
    expect(csv.endsWith('\n')).toBe(false);
  });

  it('contain mixed pairs, one dominant contingent, and injected dirty data', () => {
    const rows = parseCsv(generateSyntheticCsv(ruleSet, defaultSyntheticOptions(5000, '5000'))).rows;
    const pairs = rows.filter((r) => r['class'] === 'PAIR');
    expect(pairs.length).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const r of rows)
      counts.set(r['tim_kontingen'] ?? '', (counts.get(r['tim_kontingen'] ?? '') ?? 0) + 1);
    const top = Math.max(...counts.values()) / rows.length;
    expect(top).toBeGreaterThan(0.2);
    expect(top).toBeLessThan(0.35);
    expect(rows.some((r) => r['tinggibadan'] === '0.00')).toBe(true);
    expect(rows.some((r) => r['nik']?.endsWith('.'))).toBe(true);
  });

  it.each(['SYNTHETIC_5K', 'SYNTHETIC_10K'])(
    '%s matches its pinned fingerprint (generator drift detection)',
    (name) => {
      const spec = manifest.datasets[name];
      expect(spec?.entries).toBeDefined();
      const csv = generateSyntheticCsv(
        ruleSet,
        defaultSyntheticOptions(spec?.entries ?? 0, spec?.seed ?? '0'),
      );
      expect(sha256Hex(csv)).toBe(spec?.sha256);
    },
  );
});

describe('simulate (Phase 1 skeleton)', () => {
  const datasetBytes = new TextEncoder().encode(
    generateSyntheticCsv(ruleSet, defaultSyntheticOptions(300, '1')),
  );
  const request = {
    datasetName: 'synthetic-300.csv',
    datasetBytes,
    ruleSet,
    engineVersion: '0.1.0',
    purpose: 'SIMULATION' as const,
    goldenSeed: parseDrawSeed(manifest.goldenSeed),
    seeds: manifest.robustnessSeeds.slice(0, 5).map(parseDrawSeed),
    assumptions: null,
    baseline,
  };

  it('runs every seed, reports the engine refusal honestly, and replays identically', () => {
    const { report } = simulate(request);
    expect(report.seeds).toHaveLength(6);
    expect(report.seeds.every((s) => s.status === 'UNSAFE')).toBe(true);
    expect(report.seeds[0]?.unsafeReasons.map((r) => r.code)).toContain('ENGINE_STAGE_NOT_IMPLEMENTED');
    expect(report.preEngine).toContainEqual({ stage: 'toEngineEntries', status: 'NOT_IMPLEMENTED' });
    expect(report.safety).toEqual({ allSeedsSafe: false, invariantViolations: 0, replayIdentical: true });
  });

  it('produces the same report fingerprint for the same request', () => {
    expect(simulate(request).fingerprint).toBe(simulate(request).fingerprint);
  });

  it('reports lock blockers of the provisional rule set without filling any value', () => {
    const { report } = simulate(request);
    expect(report.ruleSet.allowedForPurpose).toBe(true);
    expect(report.ruleSet.lockAllowed).toBe(false);
    expect(report.ruleSet.lockBlockers.filter((b) => b.startsWith('MAX_TOLERANCE_UNSET'))).toHaveLength(4);
  });

  it('records simulation assumptions in the report and refuses them for candidate draws', () => {
    const assumptions = {
      maxTolerances: [
        { policyCode: 'KYORUGI_SEMI_POOL', dimension: 'HEIGHT' as const, ageDivisionCode: null, value: 100 },
      ],
    };
    expect(simulate({ ...request, assumptions }).report.assumptions).toEqual(assumptions);
    const candidate = simulate({ ...request, purpose: 'CANDIDATE', assumptions }).report;
    expect(candidate.seeds[0]?.unsafeReasons.map((r) => r.code)).toContain(
      'ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE',
    );
  });

  it('marks every baseline metric NOT_AVAILABLE until the engine produces pools', () => {
    const comparisons = simulate(request).report.baseline?.comparisons ?? [];
    expect(comparisons.length).toBeGreaterThan(20);
    expect(comparisons.every((c) => c.status === 'NOT_AVAILABLE')).toBe(true);
  });
});

describe('baseline comparison', () => {
  it('classifies by metric direction', () => {
    const c = compareToBaseline(baseline, {
      'semiPrestasi.kyorugi.pctPoolsWeightWithin5kg': 95,
      'semiPrestasi.kyorugi.round1SameContingentPct': 6,
      'semiPrestasi.singletonPools': 25,
    });
    const status = (m: string) => c.find((x) => x.metric === m)?.status;
    expect(status('semiPrestasi.kyorugi.pctPoolsWeightWithin5kg')).toBe('BETTER');
    expect(status('semiPrestasi.kyorugi.round1SameContingentPct')).toBe('WORSE');
    expect(status('semiPrestasi.singletonPools')).toBe('EQUAL');
    expect(status('semiPrestasi.kyorugi.pctPoolsHeightWithin5cm')).toBe('NOT_AVAILABLE');
  });
});
