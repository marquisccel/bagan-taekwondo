import { describe, expect, it } from 'vitest';

import type { CategorySummary } from './api';
import { EMPTY_FILTERS, filterCategories } from './category-filters';

const cat = (over: Partial<CategorySummary>): CategorySummary => ({
  category_id: 'a',
  category_key: 'KYORUGI|AGE=CADET|GENDER=MALE|WEIGHT=-45',
  stream: 'PRESTASI',
  discipline: 'KYORUGI',
  format: 'INDIVIDUAL',
  gender: 'MALE',
  movement: null,
  readiness: 'READY',
  blocked_reasons: [],
  selected_strategy: null,
  poolCount: 1,
  entryCount: 4,
  quality: 'GREEN',
  ...over,
});

describe('filterCategories', () => {
  const categories = [
    cat({
      category_id: 'a',
      category_key: 'KYORUGI-A',
      discipline: 'KYORUGI',
      readiness: 'READY',
      quality: 'GREEN',
    }),
    cat({
      category_id: 'b',
      category_key: 'POOMSAE-B',
      discipline: 'POOMSAE',
      readiness: 'BLOCKED',
      quality: 'RED',
    }),
    cat({
      category_id: 'c',
      category_key: 'KYORUGI-C',
      discipline: 'KYORUGI',
      readiness: 'READY',
      quality: 'YELLOW',
    }),
  ];

  it('returns everything with empty filters', () => {
    expect(filterCategories(categories, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('filters by category key search, case-insensitively', () => {
    expect(
      filterCategories(categories, { ...EMPTY_FILTERS, search: 'poomsae' }).map((c) => c.category_id),
    ).toEqual(['b']);
  });

  it('filters by discipline', () => {
    expect(
      filterCategories(categories, { ...EMPTY_FILTERS, discipline: 'KYORUGI' }).map((c) => c.category_id),
    ).toEqual(['a', 'c']);
  });

  it('filters by readiness', () => {
    expect(
      filterCategories(categories, { ...EMPTY_FILTERS, readiness: 'BLOCKED' }).map((c) => c.category_id),
    ).toEqual(['b']);
  });

  it('filters by quality', () => {
    expect(
      filterCategories(categories, { ...EMPTY_FILTERS, quality: 'YELLOW' }).map((c) => c.category_id),
    ).toEqual(['c']);
  });

  it('combines filters (AND, not OR)', () => {
    expect(
      filterCategories(categories, { ...EMPTY_FILTERS, discipline: 'KYORUGI', quality: 'GREEN' }).map(
        (c) => c.category_id,
      ),
    ).toEqual(['a']);
  });
});
