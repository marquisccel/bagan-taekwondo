import { describe, expect, it } from 'vitest';

import { DomainError } from './errors.js';
import { parseDrawSeed, Prng } from './prng.js';

// Known-answer vectors produced by an independent Python implementation
// (docs/adr/0006-deterministic-engine.md, "Cross-implementation vectors").
describe('Prng known-answer vectors', () => {
  it('matches the reference sequence for a category-labelled stream', () => {
    const g = Prng.fromSeed(parseDrawSeed('20260827'), 'category:KYORUGI|SEMI_PRESTASI|CADET|MALE|-41');
    expect(Array.from({ length: 8 }, () => g.nextUint32())).toEqual([
      2290944537, 2182066128, 1377245043, 1063152604, 3441794429, 4073847411, 667753353, 3618238874,
    ]);
  });

  it('matches the reference sequence for seed 0 and for the maximum 64-bit seed', () => {
    const zero = Prng.fromSeed(parseDrawSeed('0'), 'x');
    expect(Array.from({ length: 4 }, () => zero.nextUint32())).toEqual([
      3772326568, 4251444859, 2664265209, 530372285,
    ]);
    const max = Prng.fromSeed(parseDrawSeed('18446744073709551615'), '');
    expect(Array.from({ length: 4 }, () => max.nextUint32())).toEqual([
      2767114352, 2244572164, 2753757875, 1976511620,
    ]);
  });

  it('matches the reference for bounded draws and shuffles', () => {
    const b = Prng.fromSeed(parseDrawSeed('42'), 'shuffle');
    expect(Array.from({ length: 10 }, () => b.nextBelow(7))).toEqual([0, 0, 3, 6, 5, 3, 0, 2, 1, 4]);
    const s = Prng.fromSeed(parseDrawSeed('42'), 'shuffle2');
    expect(s.shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([7, 6, 4, 9, 5, 2, 8, 1, 0, 3]);
  });
});

describe('parseDrawSeed', () => {
  it.each(['', '-1', '01', '1.5', 'abc', '18446744073709551616', ' 1'])('rejects %j', (input) => {
    expect(() => parseDrawSeed(input)).toThrow(DomainError);
  });

  it.each(['0', '1', '20260827', '18446744073709551615'])('accepts %j', (input) => {
    expect(parseDrawSeed(input)).toBe(input);
  });
});

describe('Prng streams', () => {
  it('derives independent streams per label', () => {
    const seed = parseDrawSeed('7');
    const a = Prng.fromSeed(seed, 'category:A').nextUint32();
    const b = Prng.fromSeed(seed, 'category:B').nextUint32();
    expect(a).not.toBe(b);
  });

  it('does not mutate the input of shuffled()', () => {
    const input = [1, 2, 3, 4];
    Prng.fromSeed(parseDrawSeed('1'), 't').shuffled(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});
