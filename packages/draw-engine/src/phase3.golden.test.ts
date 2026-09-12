import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isPlaceable } from '@bagantkd/domain';
import { runIntake, type IntakeSnapshot } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed, type DrawSeed } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { ENGINE_VERSION, type EngineOutput } from './contract.js';
import { exhaustivePartition } from './exhaustive.js';
import { checkPlacementInvariants } from './invariants.js';
import { buildCandidates, rankCandidates, resolvePolicy, type PoolEntry } from './pooling.js';
import { runDraw } from './run.js';

/**
 * Phase 3 acceptance gate on the real 2026 data (ACCEPTANCE_CRITERIA §5 Phase 3). Heavy loops
 * yield to the event loop between runs so the test worker stays responsive.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const datasetPath = root('data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv');
const available = existsSync(datasetPath);
const manifest = JSON.parse(readFileSync(root('fixtures/datasets/manifest.json'), 'utf-8')) as {
  goldenSeed: string;
  robustnessSeeds: string[];
  engineFingerprints?: Record<string, Record<string, string>>;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Release gate: GOLDEN_REPLAY_RUNS=100 (ACCEPTANCE §5 Phase 3); everyday runs use 10. */
const REPLAY_RUNS = Number(process.env['GOLDEN_REPLAY_RUNS'] ?? '10');

describe.skipIf(!available)('Phase 3 gate — REAL_2026', () => {
  let rs: RuleSet;
  let snapshot: IntakeSnapshot;
  let scope: string[];
  let golden: EngineOutput;
  const draw = (seed: DrawSeed) =>
    runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION',
      seed,
      ruleSet: rs,
      entries: snapshot.entries,
      scope,
      assumptions: null,
    });

  beforeAll(() => {
    rs = JSON.parse(
      readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
    ) as RuleSet;
    const intake = runIntake({ sourceName: 'REAL_2026', bytes: readFileSync(datasetPath), ruleSet: rs });
    snapshot = intake.snapshot as IntakeSnapshot;
    expect(snapshot.entries).toHaveLength(3115);
    scope = [];
    const plan = draw(parseDrawSeed(manifest.goldenSeed));
    expect(plan.categories).toHaveLength(238);
    scope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
    golden = draw(parseDrawSeed(manifest.goldenSeed));
  }, 120_000);

  it('Gate A on the golden seed and all 20 robustness seeds: SAFE, INV-02/03 hold, every eligible drawn entry placed exactly once', async () => {
    const eligibleOf = (out: EngineOutput) => {
      const inScope = new Set(out.categories.flatMap((c) => c.entryIds));
      return snapshot.entries
        .filter((e) => isPlaceable(e.eligibility) && inScope.has(e.entryId))
        .map((e) => e.entryId);
    };
    for (const s of [manifest.goldenSeed, ...manifest.robustnessSeeds]) {
      const out = s === manifest.goldenSeed ? golden : draw(parseDrawSeed(s));
      expect(out.status, `seed ${s}`).toBe('SAFE');
      const placements = out.categories.flatMap((c) =>
        c.pools.flatMap((p) => p.entryIds.map((entryId) => ({ poolUid: p.poolUid, entryId }))),
      );
      expect(checkPlacementInvariants(eligibleOf(out), placements), `seed ${s}`).toEqual([]);
      const semiEligible = snapshot.entries.filter(
        (e) => e.stream === 'SEMI_PRESTASI' && eligibleOf(out).includes(e.entryId),
      ).length;
      expect(
        placements.filter(
          (p) => snapshot.entries.find((e) => e.entryId === p.entryId)?.stream === 'SEMI_PRESTASI',
        ),
      ).toHaveLength(semiEligible);
      await tick();
    }
  }, 600_000);

  it(`deterministic replay: ${REPLAY_RUNS} consecutive golden-seed runs produce one output fingerprint (recorded per engine version)`, async () => {
    const fps = new Set<string>([golden.fingerprints.output]);
    for (let i = 1; i < REPLAY_RUNS; i += 1) {
      fps.add(draw(parseDrawSeed(manifest.goldenSeed)).fingerprints.output);
      await tick();
    }
    expect(fps.size).toBe(1);
    process.stdout.write(
      `  [phase3] engine ${ENGINE_VERSION} REAL_2026 golden output ${golden.fingerprints.output}\n`,
    );
    const recorded = manifest.engineFingerprints?.[ENGINE_VERSION]?.['REAL_2026'];
    if (recorded) expect(golden.fingerprints.output).toBe(recorded);
  }, 1_200_000);

  it('exhaustive pooling comparison for every pooled category of ≤ 10 entries (Tier-1 gap; slack spent on Tier 2 reported)', () => {
    const rank = new Map(rs.belts.map((b) => [b.code, b.rank]));
    const rows: { n: number; tier1Gap: number; slackUsed: number; tier2Gain: number }[] = [];
    for (const c of golden.categories.filter((x) => x.candidates.length > 0 && x.entryIds.length <= 10)) {
      const template = rs.categoryTemplates.find((t) => t.code === c.templateCode);
      const es = snapshot.entries.filter((e) => c.entryIds.includes(e.entryId));
      const policy = resolvePolicy(
        rs,
        rs.poolPolicies.find((p) => p.code === template?.poolPolicyCode) ?? (rs.poolPolicies[0] as never),
        es[0]?.ageDivisionCode ?? '',
      );
      const pe: PoolEntry[] = es.map((e) => ({
        id: e.entryId,
        weightG: e.members[0]?.weightG ?? null,
        heightMm: e.members[0]?.heightMm ?? null,
        beltRank: e.members[0]?.beltCode ? (rank.get(e.members[0].beltCode) ?? null) : null,
        contingent: e.contingentKey,
      }));
      const cands = buildCandidates(pe, policy, parseDrawSeed(manifest.goldenSeed), c.categoryKey);
      const best = rankCandidates(cands)[0];
      const tier1Phase = Math.min(...cands.map((k) => k.tier1PhaseCost[1]));
      const opt = exhaustivePartition(pe, policy).best;
      rows.push({
        n: pe.length,
        tier1Gap: tier1Phase - opt[1],
        slackUsed: (best?.cost[1] ?? 0) - tier1Phase,
        tier2Gain: opt[2] - (best?.cost[2] ?? 0),
      });
    }
    const gaps = rows.filter((r) => r.tier1Gap !== 0);
    const slack = rows.filter((r) => r.slackUsed > 0);
    process.stdout.write(
      `  [phase3] exhaustive pooling: ${rows.length} categories ≤ 10; tier-1 gaps ${gaps.length}; slack spent on tier 2 in ${slack.length}: ${JSON.stringify(slack)}\n`,
    );
    expect(rows.length).toBeGreaterThan(40);
    expect(gaps).toEqual([]);
    for (const r of slack)
      expect(r.slackUsed).toBeLessThanOrEqual(rs.poolPolicies[0]?.tiers.tier1SlackFp ?? 0);
  }, 120_000);

  it('candidates kept, explainable results, category membership preserved, tolerances still UNSET', () => {
    const pooled = golden.categories.filter((c) => c.templateCode.endsWith('SEMI_PRESTASI'));
    for (const c of pooled) {
      expect(new Set(c.candidates.map((k) => k.strategy)).size).toBe(5);
      expect(c.candidates.filter((k) => k.selected)).toHaveLength(1);
      expect(c.candidates.find((k) => k.selected)?.tier0Violations).toBe(0);
    }
    const byId = new Map(snapshot.entries.map((e) => [e.entryId, e]));
    for (const c of golden.categories) {
      for (const p of c.pools) {
        expect(p.reasons.length).toBeGreaterThan(0);
        for (const s of p.bracket.slots) if (s.entryId === null) expect(s.byeReason).not.toBeNull();
        for (const id of p.entryIds) expect(byId.get(id)?.categoryKey).toBe(c.categoryKey);
      }
    }
    expect(rs.poolPolicies.flatMap((p) => p.tolerances).every((t) => t.max.status === 'UNSET')).toBe(true);
    const m = golden.quality.metrics;
    process.stdout.write(
      `  [phase3] golden: ${golden.categories.length} categories, ${m['pools']} pools, ${m['entriesPlaced']} entries, ${m['poolsWalkover']} walkovers, ${m['byes']} byes, ${m['realMatches']} real matches\n`,
    );
  });
});
