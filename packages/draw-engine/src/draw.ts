import type { CategoryTemplate, PoolPolicy, RuleSet } from '@bagantkd/rules';
import { compareNumbers, deterministicUuid, type DrawSeed } from '@bagantkd/shared';

import { buildBracket, checkBracket, type BracketEntry } from './bracket.js';
import type { EngineEntry, PoolResult, QualityFinding, Reason, StrategyCandidate } from './contract.js';
import {
  buildCandidates,
  poolCost,
  rankCandidates,
  resolvePolicy,
  type PoolEntry,
  type PoolingCandidate,
  type ResolvedPolicy,
} from './pooling.js';
import type { MetricPool } from './quality.js';
import type { EngineLimits } from './limits.js';
import type { BuiltCategory } from './stages.js';

/**
 * Stages 5–14 for one READY category: pools (5–7), brackets with byes, seeds and contingent
 * separation (8–11), match identities (12), quality inputs (13) and explanations (14).
 * Pool formation never looks at bracket placement; placement never changes a pool (Phase 3E).
 */
export interface CategoryDraw {
  readonly pools: PoolResult[];
  readonly candidates: StrategyCandidate[];
  readonly reasons: Reason[];
  readonly blocked: Reason[];
  readonly findings: QualityFinding[];
  readonly selfCheck: Reason[];
  readonly metricPools: MetricPool[];
}

const DIM_CODE = {
  WEIGHT: 'POOL_CLOSED_BY_WEIGHT_RANGE',
  HEIGHT: 'POOL_CLOSED_BY_HEIGHT_RANGE',
  BELT: 'POOL_CLOSED_BY_BELT_RANGE',
} as const;

export function drawCategory(args: {
  readonly rs: RuleSet;
  readonly category: BuiltCategory;
  readonly template: CategoryTemplate;
  readonly entries: ReadonlyMap<string, EngineEntry>;
  readonly seed: DrawSeed;
  readonly limits: EngineLimits;
}): CategoryDraw {
  const { rs, category, template, seed } = args;
  const key = category.categoryKey;
  const out: CategoryDraw = {
    pools: [],
    candidates: [],
    reasons: [],
    blocked: [],
    findings: [],
    selfCheck: [],
    metricPools: [],
  };
  const members = category.entryIds
    .map((id) => args.entries.get(id))
    .filter((e): e is EngineEntry => e !== undefined);
  if (members.length === 0) return out;

  if (template.drawFormat === 'PERFORMANCE_ORDER') {
    out.blocked.push({ code: 'DRAW_FORMAT_NOT_IMPLEMENTED', params: { drawFormat: template.drawFormat } });
    return out;
  }
  // Manual seeds must be unambiguous; a seed number is a rank within the category (INV-08).
  const seedNos = members.map((e) => e.seedNo).filter((x): x is number => x !== null);
  const duplicate = seedNos.find((x, i) => seedNos.indexOf(x) !== i);
  if (duplicate !== undefined) {
    out.blocked.push({
      code: 'MANUAL_SEED_INVALID',
      params: { problem: 'DUPLICATE_SEED_NO', seedNo: duplicate },
    });
    return out;
  }
  const outOfRange = seedNos.find((x) => x > members.length);
  if (template.drawFormat === 'SINGLE_ELIMINATION' && outOfRange !== undefined) {
    out.blocked.push({
      code: 'MANUAL_SEED_INVALID',
      params: { problem: 'SEED_NO_OUT_OF_RANGE', seedNo: outOfRange, entries: members.length },
    });
    return out;
  }
  if (template.drawFormat === 'SINGLE_ELIMINATION' && members.length > args.limits.maxBracketEntries) {
    out.blocked.push({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: {
        limit: 'maxBracketEntries',
        value: args.limits.maxBracketEntries,
        actual: members.length,
        scope: key,
      },
    });
    return out;
  }
  const beltRank = new Map(rs.belts.map((b) => [b.code, b.rank]));
  const toPoolEntry = (e: EngineEntry): PoolEntry => {
    const m = e.members[0];
    return {
      id: e.entryId,
      weightG: m?.weightG ?? null,
      heightMm: m?.heightMm ?? null,
      beltRank: m?.beltCode ? (beltRank.get(m.beltCode) ?? null) : null,
      contingent: e.contingentKey,
    };
  };

  let partition: PoolEntry[][];
  let policy: PoolPolicy | null = null;
  let resolved: ResolvedPolicy | null = null;
  let selected: PoolingCandidate | null = null;
  if (template.drawFormat === 'POOLED_SINGLE_ELIMINATION') {
    policy = rs.poolPolicies.find((p) => p.code === template.poolPolicyCode) ?? null;
    if (!policy) {
      out.blocked.push({ code: 'POOL_POLICY_MISSING', params: { poolPolicyCode: template.poolPolicyCode } });
      return out;
    }
    if (template.format !== 'INDIVIDUAL') {
      out.blocked.push({ code: 'POOLING_REQUIRES_INDIVIDUAL_FORMAT', params: { format: template.format } });
      return out;
    }
    if (policy.contingentKey === 'GROUP') {
      out.blocked.push({
        code: 'CONTINGENT_GROUPS_UNAVAILABLE',
        params: { contingentKey: policy.contingentKey },
      });
      return out;
    }
    if (policy.poolMax > args.limits.maxPoolSize) {
      out.blocked.push({
        code: 'RESOURCE_LIMIT_EXCEEDED',
        params: { limit: 'maxPoolSize', value: args.limits.maxPoolSize, actual: policy.poolMax, scope: key },
      });
      return out;
    }
    resolved = resolvePolicy(rs, policy, members[0]?.ageDivisionCode ?? '');
    const built = buildCandidates(
      members.map(toPoolEntry),
      resolved,
      seed,
      key,
      args.limits.maxWorkPerCandidate,
    );
    const capped = built.find((c) => c.search.workCapHit);
    if (capped) {
      out.blocked.push({
        code: 'RESOURCE_LIMIT_EXCEEDED',
        params: {
          limit: 'maxWorkPerCandidate',
          value: args.limits.maxWorkPerCandidate,
          actual: capped.search.work,
          scope: key,
          strategy: capped.strategy,
        },
      });
      return out;
    }
    const ranked = rankCandidates(built);
    selected = ranked[0] ?? null;
    out.candidates.push(
      ...ranked.map((c, i) => candidateResult(c, i + 1, ranked, resolved as ResolvedPolicy)),
    );
    if (!selected || selected.cost[0] > 0) {
      out.blocked.push({ code: 'POOL_INFEASIBLE', params: { tier0Violations: selected?.cost[0] ?? -1 } });
      return out;
    }
    partition = selected.pools.map((p) => [...p]);
    // ADR-0009 alternative policy: a singleton blocks the category until a person decides.
    if (policy.singleton.policy === 'BLOCK_CATEGORY') {
      const singletons = partition.filter((p) => p.length === 1);
      if (singletons.length > 0) {
        for (const p of singletons) {
          out.blocked.push({
            code: 'SINGLETON_POLICY_BLOCK',
            params: {
              entryId: p[0]?.id ?? '',
              policy: policy.singleton.policy,
              provenance: policy.singleton.provenance.source,
            },
          });
        }
        return out;
      }
    }
    const runnerUp = ranked[1];
    out.reasons.push({
      code: 'CANDIDATE_SELECTED',
      params: {
        strategy: selected.strategy,
        tier1CostFp: selected.cost[1],
        tier2CostFp: selected.cost[2],
        contingentSpread: selected.spread,
        runnerUp: runnerUp?.strategy ?? null,
        runnerUpTier1CostFp: runnerUp?.cost[1] ?? null,
        rule: 'LOWEST_TIER0_TIER1_TIER2_TIER3_THEN_STRATEGY_ORDER',
      },
    });
  } else {
    partition = [members.map(toPoolEntry)];
  }

  // Contingent structure of the category (explains unavoidable same-contingent meetings).
  const contingents = new Map<string, number>();
  for (const e of members) contingents.set(e.contingentKey, (contingents.get(e.contingentKey) ?? 0) + 1);

  partition.forEach((pool, idx) => {
    const ordinal = idx + 1;
    const poolUid = deterministicUuid('bagantkd/pool', `${key}|${ordinal}`);
    // Manual seeds keep their relative order inside the pool (1 = best seed).
    const seeded = pool
      .map((p) => args.entries.get(p.id))
      .filter((e): e is EngineEntry => e?.seedNo !== null && e?.seedNo !== undefined)
      .sort((a, b) => compareNumbers(a.seedNo ?? 0, b.seedNo ?? 0));
    const relSeed = new Map(seeded.map((e, i) => [e.entryId, i + 1]));
    const bracketEntries: BracketEntry[] = pool.map((p) => ({
      id: p.id,
      contingent: p.contingent,
      seedNo: relSeed.get(p.id) ?? null,
      beltRank: p.beltRank,
    }));
    const bracket = buildBracket({
      entries: bracketEntries,
      seed,
      label: `${key}#${ordinal}`,
      byePolicy: template.byePolicy ?? 'SEED_PRIORITY',
      budgetPerEntry: policy?.localSearchBudgetPerEntry ?? 200,
    });
    for (const v of checkBracket(bracket, bracketEntries)) {
      out.selfCheck.push({
        code: 'BRACKET_INVARIANT_VIOLATED',
        params: { categoryKey: key, pool: ordinal, violation: v.code, detail: v.detail },
      });
    }
    const matches = bracket.matches.map((m) => ({
      ...m,
      matchUid: deterministicUuid('bagantkd/match', `${key}|${ordinal}|${m.round}|${m.position}`),
    }));

    const reasons: Reason[] = [];
    const metrics: Record<string, number> = {
      size: pool.length,
      byes: bracket.byes,
      realMatches: matches.filter((m) => m.real).length,
    };
    if (resolved && policy) {
      const c = poolCost(pool, resolved);
      Object.assign(metrics, {
        tier0: c.tier0,
        tier1CostFp: c.tier1,
        tier2CostFp: c.tier2,
        contingentSpread: c.spread,
        minSameContingentRound1: c.minSameRound1,
      });
      reasons.push({
        code: 'POOL_SIZE_PREFERENCE',
        params: {
          size: pool.length,
          poolTarget: resolved.poolTarget,
          poolMax: resolved.poolMax,
          sizePenaltyFp: resolved.sizePenaltyFp[pool.length] ?? 0,
        },
      });
      resolved.dimensions.forEach((d, i) => {
        const range = c.ranges[i] ?? 0;
        metrics[`range${d.dimension}`] = range;
        reasons.push({
          code: 'POOL_RANGE',
          params: { dimension: d.dimension, range, ideal: d.ideal, withinIdeal: range <= d.ideal },
        });
      });
      reasons.push(...closureReasons(pool, partition, idx, resolved, members.length));
      if (pool.length >= 2 && contingents.size > 1) {
        const perContingent = new Map<string, number>();
        for (const e of pool) perContingent.set(e.contingent, (perContingent.get(e.contingent) ?? 0) + 1);
        reasons.push({
          code: 'POOL_CONTINGENT_MIX',
          params: {
            size: pool.length,
            distinctContingents: perContingent.size,
            largestGroup: Math.max(...perContingent.values()),
            spread: c.spread,
          },
        });
      }
      if (pool.length === 1) {
        reasons.push({
          code: 'SINGLETON_WALKOVER',
          params: { policy: policy.singleton.policy, provenance: policy.singleton.provenance.source },
        });
        out.findings.push({
          level: 'WARNING',
          code: 'SINGLETON_WALKOVER',
          subject: pool[0]?.id ?? '',
          params: { categoryKey: key, pool: ordinal },
        });
        out.reasons.push(
          ...mergeSuggestions(
            rs,
            template,
            key,
            pool[0]?.id ?? '',
            members[0]?.categoryGender ?? null,
            members[0],
          ),
        );
      }
      if (pool.length >= 2 && new Set(pool.map((p) => p.contingent)).size === 1) {
        const stats = selected?.search.rejected;
        reasons.push(
          contingents.size === 1
            ? { code: 'CATEGORY_SINGLE_CONTINGENT', params: { contingent: pool[0]?.contingent ?? '' } }
            : {
                code: 'SINGLE_CONTINGENT_NO_FEASIBLE_SWAP',
                params: {
                  contingent: pool[0]?.contingent ?? '',
                  categoryContingents: contingents.size,
                  rejectedIdealRegression: stats?.IDEAL_REGRESSION ?? 0,
                  rejectedTier1Slack: stats?.TIER1_SLACK_EXCEEDED ?? 0,
                  rejectedNoTier2Gain: stats?.NO_TIER2_GAIN ?? 0,
                  rejectedSingletonCreation: stats?.SINGLETON_CREATION ?? 0,
                },
              },
        );
        out.findings.push({
          level: 'INFO',
          code: 'SINGLE_CONTINGENT_POOL',
          subject: poolUid,
          params: { categoryKey: key, pool: ordinal },
        });
      }
    } else {
      reasons.push({
        code: 'POOL_IS_WHOLE_CATEGORY',
        params: { drawFormat: template.drawFormat, entries: pool.length },
      });
      if (pool.length === 1) {
        reasons.push({
          code: 'SINGLETON_WALKOVER',
          params: { policy: 'CATEGORY_HAS_ONE_ENTRY', provenance: 'ENGINEERING_DEFAULT' },
        });
        out.findings.push({
          level: 'WARNING',
          code: 'SINGLETON_WALKOVER',
          subject: pool[0]?.id ?? '',
          params: { categoryKey: key, pool: ordinal },
        });
        out.reasons.push(
          ...mergeSuggestions(
            rs,
            template,
            key,
            pool[0]?.id ?? '',
            members[0]?.categoryGender ?? null,
            members[0],
          ),
        );
      }
    }
    const sameRound1 = bracket.search.sameContingentByRound[0] ?? 0;
    if (sameRound1 > 0) {
      reasons.push({
        code: 'SAME_CONTINGENT_ROUND1_UNAVOIDABLE',
        params: { meetings: sameRound1, placement: bracket.search.method },
      });
    }
    out.pools.push({
      poolUid,
      ordinal,
      entryIds: pool.map((p) => p.id),
      isWalkover: pool.length === 1,
      reasons,
      metrics,
      bracket: {
        size: bracket.size,
        rounds: bracket.rounds,
        entries: bracket.entries,
        byes: bracket.byes,
        slots: bracket.slots,
        matches,
        placement: bracket.search,
      },
    });
    if (template.drawFormat === 'POOLED_SINGLE_ELIMINATION') {
      const bySlot = new Map(bracket.slots.map((s) => [s.position, s.entryId]));
      const round1Pairs = bracket.matches
        .filter((m) => m.round === 1 && m.real && 'slot' in m.feederA && 'slot' in m.feederB)
        .map(
          (m) =>
            [
              bySlot.get('slot' in m.feederA ? m.feederA.slot : 0) ?? '',
              bySlot.get('slot' in m.feederB ? m.feederB.slot : 0) ?? '',
            ] as const,
        );
      out.metricPools.push({
        discipline: template.discipline === 'POOMSAE' ? 'POOMSAE' : 'KYORUGI',
        members: pool,
        round1Pairs,
      });
    }
  });
  return out;
}

/** Why a pool is not larger: its size limit, or the cheapest entry that could join and what it costs. */
function closureReasons(
  pool: readonly PoolEntry[],
  partition: readonly (readonly PoolEntry[])[],
  idx: number,
  p: ResolvedPolicy,
  categorySize: number,
): Reason[] {
  if (categorySize === 1) return [{ code: 'CATEGORY_HAS_ONE_ENTRY', params: {} }];
  if (partition.length === 1) return [{ code: 'POOL_IS_WHOLE_CATEGORY', params: { entries: pool.length } }];
  if (pool.length >= p.poolMax)
    return [{ code: 'POOL_CLOSED_BY_SIZE_LIMIT', params: { poolMax: p.poolMax } }];
  const base = poolCost(pool, p);
  let best: { entry: PoolEntry; delta: number; ranges: readonly number[] } | null = null;
  partition.forEach((other, j) => {
    if (j === idx) return;
    for (const e of other) {
      const c = poolCost([...pool, e], p);
      const delta = c.tier1 - base.tier1;
      if (!best || delta < best.delta) best = { entry: e, delta, ranges: c.ranges };
    }
  });
  const b = best as { entry: PoolEntry; delta: number; ranges: readonly number[] } | null;
  if (!b) return [{ code: 'POOL_SIZE_PREFERENCE', params: { size: pool.length } }];
  // The dimension whose normalized range grows most explains the closure.
  let dim = 0;
  let worst = -Infinity;
  p.dimensions.forEach((d, i) => {
    const growth = ((b.ranges[i] ?? 0) - (base.ranges[i] ?? 0)) / d.ideal;
    if (growth > worst) {
      worst = growth;
      dim = i;
    }
  });
  const d = p.dimensions[dim];
  const reason: Reason = {
    code: d ? DIM_CODE[d.dimension] : 'POOL_SIZE_PREFERENCE',
    params: {
      nearestEntry: b.entry.id,
      rangeIfAdded: b.ranges[dim] ?? 0,
      ideal: d?.ideal ?? 0,
      tier1DeltaFp: b.delta,
    },
  };
  return pool.length === 1
    ? [
        { ...reason },
        {
          code: 'SINGLETON_NO_COMPATIBLE_PARTNER',
          params: { nearestEntry: b.entry.id, tier1DeltaFp: b.delta },
        },
      ]
    : [reason];
}

/** ADR-0009: ranked adjacent-class suggestions for a walkover; never applied by the engine. */
function mergeSuggestions(
  rs: RuleSet,
  template: CategoryTemplate,
  key: string,
  entryId: string,
  gender: string | null,
  entry: EngineEntry | undefined,
): Reason[] {
  if (!template.dimensions.includes('WEIGHT_CLASS') || !entry?.weightClassCode) {
    return [
      {
        code: 'NO_MERGE_SUGGESTION',
        params: {
          entryId,
          reason: template.dimensions.includes('MOVEMENT')
            ? 'MOVEMENT_IS_HARD'
            : 'NO_ADJACENT_CLASS_DIMENSION',
        },
      },
    ];
  }
  const table = rs.weightClassTables.find(
    (t) => t.stream === entry.stream && t.ageDivisionCode === entry.ageDivisionCode && t.gender === gender,
  );
  const i = table?.classes.findIndex((c) => c.code === entry.weightClassCode) ?? -1;
  const out: Reason[] = [];
  for (const [direction, j] of [
    ['LIGHTER', i - 1],
    ['HEAVIER', i + 1],
  ] as const) {
    const cls = i >= 0 ? table?.classes[j] : undefined;
    if (!cls) continue;
    out.push({
      code: 'MERGE_SUGGESTION',
      params: {
        entryId,
        direction,
        suggestedCategory: key.replace(`WEIGHT_CLASS=${entry.weightClassCode}`, `WEIGHT_CLASS=${cls.code}`),
        applied: false,
        requires: 'TECHNICAL_DELEGATE_DECISION',
      },
    });
  }
  return out.length > 0
    ? out
    : [{ code: 'NO_MERGE_SUGGESTION', params: { entryId, reason: 'NO_ADJACENT_CLASS_IN_TABLE' } }];
}

function candidateResult(
  c: PoolingCandidate,
  rank: number,
  ranked: readonly PoolingCandidate[],
  p: ResolvedPolicy,
): StrategyCandidate {
  const violations: Reason[] = [];
  c.pools.forEach((pool, i) => {
    const cost = poolCost(pool, p);
    if (cost.tier0 > 0)
      violations.push({ code: 'TIER0_VIOLATION', params: { pool: i + 1, violations: cost.tier0 } });
  });
  const winner = ranked[0];
  const explanations: Reason[] = [
    rank === 1
      ? { code: 'CANDIDATE_RANK', params: { rank, selected: true } }
      : {
          code: 'CANDIDATE_RANK',
          params: {
            rank,
            selected: false,
            beatenBy: winner?.strategy ?? null,
            decidedOn:
              winner && winner.cost[0] !== c.cost[0]
                ? 'TIER0'
                : winner && winner.cost[1] !== c.cost[1]
                  ? 'TIER1'
                  : winner && winner.cost[2] !== c.cost[2]
                    ? 'TIER2'
                    : winner && winner.spread !== c.spread
                      ? 'TIER3_CONTINGENT_SPREAD'
                      : 'STRATEGY_ORDER',
          },
        },
    {
      code: 'LOCAL_SEARCH',
      params: {
        evaluated: c.search.evaluated,
        accepted: c.search.accepted,
        budgetExhausted: c.search.budgetExhausted,
      },
    },
    ...Object.entries(c.search.rejected).map(([reason, count]) => ({
      code: 'CHANGES_REJECTED',
      params: { reason, count },
    })),
  ];
  return {
    strategy: c.strategy,
    rank,
    selected: rank === 1,
    tier0Violations: c.cost[0],
    tier1CostFp: c.cost[1],
    tier2CostFp: c.cost[2],
    partition: c.pools.map((pool) => pool.map((e) => e.id)),
    metrics: {
      pools: c.pools.length,
      singletons: c.pools.filter((x) => x.length === 1).length,
      dpTier1CostFp: c.dpCost[1],
      tier1PhaseTier1CostFp: c.tier1PhaseCost[1],
      contingentSpread: c.spread,
      evaluated: c.search.evaluated,
      accepted: c.search.accepted,
      work: c.search.work,
    },
    violations,
    explanations,
  };
}
