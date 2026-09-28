import { poolCost, type PoolEntry, type ResolvedPolicy } from './pooling.js';

/**
 * Exhaustive reference for small categories (ACCEPTANCE §4): every set partition into pools of
 * size 1…poolMax, minimized lexicographically by (tier0, singleton, twoPerson, tier1, tier2) —
 * matching `dpPartition`'s own priority order (2026-09 pool-size preference: minimizing singletons,
 * then 2-person pools, always outranks physical tolerance/contingent cost). Used only to measure the
 * heuristic's gap; the optimum is exact over this search space and makes no other claim.
 */
export interface ExhaustiveResult {
  readonly partitions: number;
  readonly best: readonly [number, number, number, number, number];
  readonly bestPools: readonly (readonly PoolEntry[])[];
}

type Cost5 = [number, number, number, number, number];

export function exhaustivePartition(entries: readonly PoolEntry[], p: ResolvedPolicy): ExhaustiveResult {
  const n = entries.length;
  let best: Cost5 = [Infinity, Infinity, Infinity, Infinity, Infinity];
  let bestPools: PoolEntry[][] = [];
  let partitions = 0;
  const blocks: PoolEntry[][] = [];
  const costs: Cost5[] = [];

  const visit = (i: number, acc: Cost5) => {
    if (i === n) {
      // Close costs of all blocks (open blocks are costed incrementally below).
      partitions += 1;
      for (let k = 0; k < acc.length; k += 1) {
        const av = acc[k] as number;
        const bv = best[k] as number;
        if (av !== bv) {
          if (av < bv) {
            best = [...acc];
            bestPools = blocks.map((b) => [...b]);
          }
          break;
        }
      }
      return;
    }
    const e = entries[i] as PoolEntry;
    for (let b = 0; b <= blocks.length; b += 1) {
      const isNew = b === blocks.length;
      if (!isNew && (blocks[b]?.length ?? 0) >= p.poolMax) continue;
      if (isNew) {
        blocks.push([]);
        costs.push([0, 0, 0, 0, 0]);
      }
      const block = blocks[b] as PoolEntry[];
      const before = costs[b] as Cost5;
      block.push(e);
      const c = poolCost(block, p);
      const after: Cost5 = [c.tier0, c.singleton, c.twoPerson, c.tier1, c.tier2];
      costs[b] = after;
      visit(i + 1, [
        acc[0] - before[0] + after[0],
        acc[1] - before[1] + after[1],
        acc[2] - before[2] + after[2],
        acc[3] - before[3] + after[3],
        acc[4] - before[4] + after[4],
      ]);
      block.pop();
      costs[b] = before;
      if (isNew) {
        blocks.pop();
        costs.pop();
      }
    }
  };
  visit(0, [0, 0, 0, 0, 0]);
  return { partitions, best, bestPools };
}
