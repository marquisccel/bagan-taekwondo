/**
 * Explicit total orders. Engine code must never rely on `localeCompare` (locale-dependent),
 * default `sort()` on numbers (lexicographic), or insertion order.
 */
export type Comparator<T> = (a: T, b: T) => number;

/** Orders strings by UTF-16 code units — identical on every platform and locale. */
export const compareStrings: Comparator<string> = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const compareNumbers: Comparator<number> = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Lexicographic combination: the first comparator that distinguishes a and b wins. */
export function compareBy<T>(...comparators: readonly Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const cmp of comparators) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

export function byKey<T, K>(key: (item: T) => K, cmp: Comparator<K>): Comparator<T> {
  return (a, b) => cmp(key(a), key(b));
}

export function descending<T>(cmp: Comparator<T>): Comparator<T> {
  return (a, b) => cmp(b, a);
}

/** Returns a sorted copy. Callers must pass a comparator that is a total order (end with a unique id). */
export function sortedBy<T>(items: readonly T[], cmp: Comparator<T>): T[] {
  return items.slice().sort(cmp);
}
