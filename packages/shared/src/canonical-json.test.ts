import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical-json.js';
import type { DomainError } from './errors.js';
import { fingerprint } from './hash.js';

describe('canonicalJson', () => {
  it('sorts keys recursively and matches the reference fingerprint', () => {
    const value = { b: [1, 2, { z: null, a: true }], a: 'Kota Surabaya 2', n: -5, é: 'ü' };
    expect(canonicalJson(value)).toBe('{"a":"Kota Surabaya 2","b":[1,2,{"a":true,"z":null}],"n":-5,"é":"ü"}');
    // Reference computed independently with Python json.dumps(sort_keys=True, separators=(",", ":"))
    expect(fingerprint(value)).toBe(
      'sha256:aa37d6e90354fa07355318c934abf3a2476a4c0f078894196be3d737b0ccb5b1',
    );
  });

  it('normalizes negative zero', () => {
    expect(canonicalJson({ x: -0 })).toBe('{"x":0}');
  });

  it.each([
    ['undefined value', { a: undefined }, 'CANONICAL_JSON_UNDEFINED_VALUE'],
    ['NaN', { a: Number.NaN }, 'CANONICAL_JSON_NON_FINITE_NUMBER'],
    ['Infinity', [Number.POSITIVE_INFINITY], 'CANONICAL_JSON_NON_FINITE_NUMBER'],
    ['Date', { d: new Date(0) }, 'CANONICAL_JSON_NON_PLAIN_OBJECT'],
    ['Map', new Map(), 'CANONICAL_JSON_NON_PLAIN_OBJECT'],
    ['bigint', { n: 1n }, 'CANONICAL_JSON_UNSUPPORTED_TYPE'],
  ])('rejects %s', (_label, value, code) => {
    expect(() => canonicalJson(value)).toThrowError(expect.objectContaining({ code }) as DomainError);
  });
});

describe('canonicalJson properties', () => {
  const jsonValue = fc.jsonValue();

  it('is insensitive to key insertion order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), jsonValue), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
      }),
    );
  });

  it('round-trips through JSON.parse to an equal canonical form', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const once = canonicalJson(value);
        expect(canonicalJson(JSON.parse(once))).toBe(once);
      }),
    );
  });
});
