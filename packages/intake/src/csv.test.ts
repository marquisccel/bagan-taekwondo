import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseCsv, toCsv } from './csv.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines', () => {
    const t = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n1,2,3');
    expect(t.rows).toEqual([
      { a: 'x, y', b: 'say "hi"', c: 'line1\nline2' },
      { a: '1', b: '2', c: '3' },
    ]);
  });

  it('counts the last row when the file has no trailing newline (F-01)', () => {
    expect(parseCsv('h\n1\n2').rows).toHaveLength(2);
    expect(parseCsv('h\n1\n2\n').rows).toHaveLength(2);
  });

  it('accepts CRLF and a UTF-8 byte-order mark', () => {
    expect(parseCsv(`${String.fromCharCode(0xfeff)}a,b\r\n1,2\r\n`).rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps the raw =+NN class notation verbatim', () => {
    expect(parseCsv('class\n=+65').rows[0]?.['class']).toBe('=+65');
  });

  it.each([
    ['a,b\n1', 'CSV_FIELD_COUNT_MISMATCH'],
    ['a\n"unterminated', 'CSV_UNTERMINATED_QUOTE'],
    ['a,a\n1,2', 'CSV_DUPLICATE_HEADER'],
    ['', 'CSV_EMPTY'],
  ])('rejects %j', (input, code) => {
    expect(() => parseCsv(input)).toThrowError(expect.objectContaining({ code }) as Error);
  });
});

describe('toCsv', () => {
  it('neutralizes formula prefixes by default but keeps plain negative numbers', () => {
    const out = toCsv(['v'], [{ v: '=+53' }, { v: '@SUM(A1)' }, { v: '-41' }, { v: '+65' }]);
    expect(out).toBe("v\n'=+53\n'@SUM(A1)\n-41\n'+65\n");
  });

  it('round-trips arbitrary text when neutralization is off', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.string(), fc.string()), { minLength: 1, maxLength: 20 }), (pairs) => {
        const rows = pairs.map(([a, b]) => ({ a, b }));
        const back = parseCsv(toCsv(['a', 'b'], rows, { neutralizeFormulas: false })).rows;
        expect(back).toEqual(rows);
      }),
    );
  });
});
