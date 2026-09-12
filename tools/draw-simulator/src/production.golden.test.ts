import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { runBenchmark } from './benchmark.js';
import { findPrivateIdentifiers, privateIdentifiers, repositoryTextFiles } from './pii-scan.js';
import { simulate, type SimulationReport } from './simulate.js';
import { renderSummary } from './summary.js';

/** REAL_2026 production checks: full coverage of every entry, explainability, and no PII anywhere. */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const datasetPath = root('data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv');
const available = existsSync(datasetPath);
const rulesPath = root('fixtures/rulesets/piala-gubernur-2026.provisional.json');

describe.skipIf(!available)('REAL_2026 production readiness', { timeout: 300_000 }, () => {
  let report: SimulationReport;
  let fp: string;
  let ruleSet: RuleSet;
  beforeAll(() => {
    ruleSet = JSON.parse(readFileSync(rulesPath, 'utf-8')) as RuleSet;
    ({ report, fingerprint: fp } = simulate({
      datasetName: 'REAL_2026.csv',
      datasetBytes: readFileSync(datasetPath),
      ruleSet,
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION',
      goldenSeed: parseDrawSeed('20260827'),
      seeds: [],
      assumptions: null,
      baseline: null,
    }));
  }, 300_000);

  it('coverage: every row and entry is accounted for, and every entry not in the draw has a reason', () => {
    expect(report.coverage).toEqual({
      rows: 3154,
      unresolvedRows: 0,
      entries: 3115,
      excludedEntries: {},
      snapshotEntries: 3115,
      eligibleEntries: 3066,
      withheldEntries: 49,
      malformedEntries: 0,
      categories: {
        total: 238,
        ready: 201,
        blocked: 37,
        zeroEligible: 12,
        blockedByReason: { DRAW_FORMAT_NOT_IMPLEMENTED: 6, ENTRIES_WITHHELD: 31, NO_ELIGIBLE_ENTRIES: 12 },
      },
      placedEntries: 2654,
      pools: 660,
      walkoverPools: 24,
      notPlaced: {
        total: 461,
        entryNotEligible: 49,
        entryNotEligibleByReason: {
          ENTRY_GROUP_UNCONFIRMED: 28,
          HEIGHT_MISSING: 8,
          HEIGHT_OUT_OF_RANGE: 1,
          HEIGHT_WEIGHT_LIKELY_SWAPPED: 11,
          WEIGHT_MISSING: 7,
        },
        categoryBlocked: 412,
        categoryBlockedByReason: { DRAW_FORMAT_NOT_IMPLEMENTED: 15, ENTRIES_WITHHELD: 397 },
      },
      everyNotPlacedEntryHasReason: true,
      accounted: true,
    });
    expect(report.safety).toEqual({
      allSeedsSafe: true,
      invariantViolations: 0,
      replayIdentical: true,
      reasons: [],
    });
  });

  it('explainability: every blocked category, pool, singleton and bye carries structured reason codes', () => {
    const snapshot = runIntake({
      sourceName: 'REAL_2026.csv',
      bytes: readFileSync(datasetPath),
      ruleSet,
    }).snapshot;
    const base = {
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION' as const,
      seed: parseDrawSeed('20260827'),
      ruleSet,
      entries: snapshot?.entries ?? [],
      assumptions: null,
    };
    const plan = runDraw({ ...base, scope: [] });
    for (const c of plan.categories.filter((x) => x.readiness === 'BLOCKED'))
      expect(c.blockedReasons.length, c.categoryKey).toBeGreaterThan(0);
    const out = runDraw({
      ...base,
      scope: plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey),
    });
    expect(out.status).toBe('SAFE');
    expect(out.lock).toMatchObject({ lockable: false });
    let singletons = 0;
    for (const c of out.categories) {
      for (const p of c.pools) {
        expect(p.reasons.length).toBeGreaterThan(0);
        expect(p.reasons.every((r) => /^[A-Z0-9_]+$/.test(r.code))).toBe(true);
        for (const s of p.bracket.slots) if (s.entryId === null) expect(s.byeReason?.code).toMatch(/^BYE_/);
        if (p.isWalkover) {
          singletons += 1;
          expect(p.reasons.map((r) => r.code)).toContain('SINGLETON_WALKOVER');
          expect(
            c.reasons.some((r) => r.code === 'MERGE_SUGGESTION' || r.code === 'NO_MERGE_SUGGESTION'),
          ).toBe(true);
        }
      }
      for (const k of c.candidates) {
        const rejected = k.explanations.filter((e) => e.code === 'CHANGES_REJECTED');
        expect(rejected.map((e) => e.params['reason']).sort()).toEqual([
          'IDEAL_REGRESSION',
          'NO_TIER1_GAIN',
          'NO_TIER2_GAIN',
          'SINGLETON_CREATION',
          'TIER0_VIOLATION',
          'TIER1_SLACK_EXCEEDED',
        ]);
      }
    }
    expect(singletons).toBe(24);
  });

  it('PII: no real NIK or name in any committable file, report, summary, CLI text or benchmark artifact', () => {
    const ids = privateIdentifiers(readFileSync(datasetPath, 'utf-8'));
    expect(ids.niks.size).toBeGreaterThan(3000);
    expect(ids.names.size).toBeGreaterThan(2000);
    const benchmark = runBenchmark({
      name: 'REAL_2026',
      datasetName: 'REAL_2026.csv',
      bytes: readFileSync(datasetPath),
      synthetic: null,
      ruleSet,
      seeds: [parseDrawSeed('20260827')],
      readinessOverride: null,
      env: {
        now: () => 0,
        isoNow: () => '2026-09-12T00:00:00.000Z',
        memory: () => ({ rss: 0, heapUsed: 0 }),
        platform: { os: 't', arch: 't', cpuModel: 't', cpus: 1, totalMemGb: 1, node: 't' },
      },
    });
    const generated = [JSON.stringify(report), renderSummary(report, fp), JSON.stringify(benchmark)];
    for (const text of generated) expect(findPrivateIdentifiers(text, ids)).toEqual([]);
    const leaks = repositoryTextFiles(root('')).flatMap((f) =>
      findPrivateIdentifiers(readFileSync(f, 'utf-8'), ids).map((h) => `${f}: ${h}`),
    );
    expect(leaks).toEqual([]);
  });
});
