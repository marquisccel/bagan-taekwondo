import { describe, expect, it } from 'vitest';

import { resolveMatchNumbers } from './match-numbering.js';

describe('resolveMatchNumbers', () => {
  it('numbers a fresh draw sequentially in canonical order when nothing is manually set', () => {
    const result = resolveMatchNumbers([
      { id: 'b', displayNo: null, order: [0, 0, 1, 2] },
      { id: 'a', displayNo: null, order: [0, 0, 1, 1] },
      { id: 'c', displayNo: null, order: [0, 0, 2, 1] },
    ]);
    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBe(2);
    expect(result.get('c')).toBe(3);
  });

  it('keeps a manually-pinned number exactly where the team put it, and never reuses it for another match', () => {
    const result = resolveMatchNumbers([
      { id: 'a', displayNo: null, order: [0, 0, 1, 1] },
      { id: 'b', displayNo: 1, order: [0, 0, 1, 2] },
      { id: 'c', displayNo: null, order: [0, 0, 2, 1] },
    ]);
    expect(result.get('b')).toBe(1);
    // 1 is taken, so the next auto slot is 2, then 3 -- never a duplicate of the pinned 1.
    expect(result.get('a')).toBe(2);
    expect(result.get('c')).toBe(3);
  });

  it('recomputes automatic numbers around a gap left by a manual number placed later in reading order', () => {
    const result = resolveMatchNumbers([
      { id: 'a', displayNo: null, order: [0, 0, 1, 1] },
      { id: 'b', displayNo: null, order: [0, 0, 1, 2] },
      { id: 'c', displayNo: 1, order: [0, 0, 2, 1] },
    ]);
    // 'c' reads last but was pinned to 1, so the two unnumbered matches fill 2 and 3 in their order.
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(3);
    expect(result.get('c')).toBe(1);
  });
});
