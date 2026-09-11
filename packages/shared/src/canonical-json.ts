import { DomainError } from './errors.js';

/**
 * Canonical JSON serialization (RFC 8785 style):
 * - object keys sorted by UTF-16 code units,
 * - no insignificant whitespace,
 * - numbers and strings serialized exactly as ECMAScript JSON does.
 *
 * It is deliberately strict: `undefined`, NaN, ±Infinity, bigint, functions, symbols and
 * non-plain objects (Date, Map, Set, class instances) are rejected instead of being
 * silently dropped or coerced, because silent coercion would make two different inputs
 * share one fingerprint.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new DomainError('CANONICAL_JSON_NON_FINITE_NUMBER', { path });
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new DomainError('CANONICAL_JSON_NON_PLAIN_OBJECT', { path });
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodeUnits);
      const parts = keys.map((key) => {
        const child = record[key];
        if (child === undefined) {
          throw new DomainError('CANONICAL_JSON_UNDEFINED_VALUE', { path: `${path}.${key}` });
        }
        return `${JSON.stringify(key)}:${serialize(child, `${path}.${key}`)}`;
      });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new DomainError('CANONICAL_JSON_UNSUPPORTED_TYPE', { path, type: typeof value });
  }
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
