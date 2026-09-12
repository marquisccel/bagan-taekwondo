import { poolCost, type PoolEntry, type ResolvedPolicy } from './pooling.js';

/**
 * Exhaustive reference for small categories (ACCEPTANCE §4): every set partition into pools of
 * size 1…poolMax, minimized lexicographically by (tier0, tier1, tier2). Used only to measure the
 * heuristic's gap; the optimum is exact over this search space and makes no other claim.
 */
export interface ExhaustiveResult {
  readonly partitions: number;
  readonly best: readonly [number, number, number];
  readonly bestPools: readonly (readonly PoolEntry[])[];
}

export function exhaustivePartition(entries: readonly PoolEntry[], p: ResolvedPolicy): ExhaustiveResult {
  const n = entries.length;
  let best: [number, number, number] = [Infinity, Infinity, Infinity];
  let bestPools: PoolEntry[][] = [];
  let partitions = 0;
  const blocks: PoolEntry[][] = [];
  const costs: [number, number, number][] = [];

  const visit = (i: number, acc: readonly [number, number, number]) => {
    if (i === n) {
      // Close costs of all blocks (open blocks are costed incrementally below).
      partitions += 1;
      if (
        acc[0] < best[0] ||
        (acc[0] === best[0] && (acc[1] < best[1] || (acc[1] === best[1] && acc[2] < best[2])))
      ) {
        best = [acc[0], acc[1], acc[2]];
        bestPools = blocks.map((b) => [...b]);
      }
      return;
    }
    const e = entries[i] as PoolEntry;
    for (let b = 0; b <= blocks.length; b += 1) {
      const isNew = b === blocks.length;
      if (!isNew && (blocks[b]?.length ?? 0) >= p.poolMax) continue;
      if (isNew) {
        blocks.push([]);
        costs.push([0, 0, 0]);
      }
      const block = blocks[b] as PoolEntry[];
      const before = costs[b] as [number, number, number];
      block.push(e);
      const c = poolCost(block, p);
      const after: [number, number, number] = [c.tier0, c.tier1, c.tier2];
      costs[b] = after;
      visit(i + 1, [
        acc[0] - before[0] + after[0],
        acc[1] - before[1] + after[1],
        acc[2] - before[2] + after[2],
      ]);
      block.pop();
      costs[b] = before;
      if (isNew) {
        blocks.pop();
        costs.pop();
      }
    }
  };
  visit(0, [0, 0, 0]);
  return { partitions, best, bestPools };
}
