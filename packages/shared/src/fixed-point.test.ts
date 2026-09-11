import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deterministicUuid, isUuid } from './deterministic-id.js';
import { compareBy, compareNumbers, compareStrings, sortedBy } from './compare.js';
import { FP_SCALE, fpAdd, fpFromInt, fpMul, fpRatio, fpScale, fpToDisplay } from './fixed-point.js';

describe('fixed point', () => {
  it('computes ratios with floor semantics', () => {
    expect(fpRatio(65, 50)).toBe(13_000); // 6.5 kg range over 5 kg tolerance = 1.3
    expect(fpRatio(1, 3)).toBe(3_333);
    expect(fpToDisplay(fpRatio(65, 50))).toBe('1.3000');
  });

  it('multiplies and scales exactly', () => {
    expect(fpMul(fpRatio(3, 2), fpRatio(3, 2))).toBe(22_500);
    expect(fpScale(fpFromInt(2), 7)).toBe(14 * FP_SCALE);
  });

  it('throws instead of overflowing', () => {
    expect(() => fpAdd(fpFromInt(2 ** 40), fpFromInt(2 ** 40))).toThrowError(/FP_/);
  });

  it('fpRatio is monotone in the numerator', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000_000),
        fc.nat(10_000_000),
        fc.integer({ min: 1, max: 1_000_000 }),
        (a, b, d) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(fpRatio(lo, d) <= fpRatio(hi, d)).toBe(true);
        },
      ),
    );
  });
});

describe('deterministicUuid', () => {
  it('matches the reference vector and is a valid version-8 UUID', () => {
    const id = deterministicUuid('bagantkd/pool', 'run-1/P-0001');
    expect(id).toBe('873812a9-f78f-8438-b9b5-4f399772b823');
    expect(isUuid(id)).toBe(true);
  });

  it('separates namespace from name unambiguously', () => {
    expect(deterministicUuid('a b', 'c')).not.toBe(deterministicUuid('a', 'b c'));
  });
});

describe('comparators', () => {
  it('orders by code units, independent of locale', () => {
    expect(sortedBy(['b', 'B', 'a', 'Á'], compareStrings)).toEqual(['B', 'a', 'b', 'Á']);
  });

  it('compareBy applies tie-breakers in order', () => {
    const rows = [
      { w: 2, id: 'b' },
      { w: 1, id: 'z' },
      { w: 2, id: 'a' },
    ];
    const cmp = compareBy<(typeof rows)[number]>(
      (x, y) => compareNumbers(x.w, y.w),
      (x, y) => compareStrings(x.id, y.id),
    );
    expect(sortedBy(rows, cmp).map((r) => r.id)).toEqual(['z', 'a', 'b']);
  });
});
