/**
 * The team's expected reading order for a list of categories within one arena/day: weight classes
 * ascending, Under before Over at the same boundary (e.g. -29, -33, ..., -78, +78) -- plain
 * `category_key` string sort put "+" before "-" (ASCII), which showed every Over class above every
 * Under class instead. Shared between the web session view (apps/api's
 * RevisionReadController.session) and the PDF/XLSX export pipeline (packages/db's
 * loadExportModel) so a match's auto-assigned print number (see match-numbering.ts) is identical on
 * screen and on paper -- if the two consumers ordered categories differently, the same unedited
 * match would show a different number in each place.
 */

/** `categoryKey` is `TEMPLATE|DIM=VALUE|...` (packages/intake/src/categories.ts) — parsed
 * generically, never assuming a fixed dimension order. */
export function categoryKeyDims(categoryKey: string): ReadonlyMap<string, string> {
  const dims = new Map<string, string>();
  for (const part of categoryKey.split('|').slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) dims.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return dims;
}

function weightSortKey(dims: ReadonlyMap<string, string>): number {
  const w = dims.get('WEIGHT_CLASS');
  const m = w ? /^([-+])(\d+)$/.exec(w) : null;
  if (!m) return Number.POSITIVE_INFINITY;
  return m[1] === '-' ? Number(m[2]) : Number(m[2]) + 0.5;
}

export function compareCategoriesByWeightClass(
  a: { readonly categoryKey: string; readonly gender: string },
  b: { readonly categoryKey: string; readonly gender: string },
): number {
  if (a.gender !== b.gender) return a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0;
  return weightSortKey(categoryKeyDims(a.categoryKey)) - weightSortKey(categoryKeyDims(b.categoryKey));
}
