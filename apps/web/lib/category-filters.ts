import type { CategorySummary } from './api';

export interface CategoryFilterState {
  readonly search: string;
  readonly discipline: string;
  readonly readiness: string;
  readonly quality: string;
}

export const EMPTY_FILTERS: CategoryFilterState = { search: '', discipline: '', readiness: '', quality: '' };

/** Pure filter over already-fetched categories — no server round-trip, no rule logic recreated. */
export function filterCategories(
  categories: readonly CategorySummary[],
  f: CategoryFilterState,
): CategorySummary[] {
  const search = f.search.trim().toLowerCase();
  return categories.filter((c) => {
    if (search && !c.category_key.toLowerCase().includes(search)) return false;
    if (f.discipline && c.discipline !== f.discipline) return false;
    if (f.readiness && c.readiness !== f.readiness) return false;
    if (f.quality && c.quality !== f.quality) return false;
    return true;
  });
}
