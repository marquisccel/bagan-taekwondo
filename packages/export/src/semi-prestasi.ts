import type {
  ExportCategory,
  ExportModel,
  ExportQuality,
  ExportRevisionMeta,
  ExportTournamentMeta,
} from './model.js';

/** Only `category.stream === 'SEMI_PRESTASI'` belongs in the compact semi-prestasi sheet. */
export const SEMI_PRESTASI_STREAM = 'SEMI_PRESTASI';

/**
 * The categories a compact semi-prestasi sheet covers, in the model's own (categoryKey) order.
 *  - `categoryId === null` (REVISION scope): every semi-prestasi category of the revision (none at
 *    all is an error — an empty official document is never useful).
 *  - a category id (CATEGORY scope): exactly that category — and it must be semi-prestasi, otherwise
 *    this throws (the API refuses such a request up front; this is the belt-and-braces guard for the worker).
 * Pure selection over the persisted model — never a recomputation.
 */
export function selectSemiPrestasiCategories(
  model: ExportModel,
  categoryId: string | null,
): readonly ExportCategory[] {
  if (categoryId === null) {
    const all = model.categories.filter((c) => c.stream === SEMI_PRESTASI_STREAM);
    if (all.length === 0) throw new Error('semi-prestasi categories not found in export model');
    return all;
  }
  const category = model.categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`category ${categoryId} not found in export model`);
  if (category.stream !== SEMI_PRESTASI_STREAM) {
    throw new Error(`category ${categoryId} is not a semi-prestasi category`);
  }
  return [category];
}

export interface SemiPrestasiFingerprintSubject {
  readonly tournament: ExportTournamentMeta;
  readonly revision: ExportRevisionMeta;
  /** Present only for a revision-scoped sheet, which prints a quality summary line. */
  readonly quality?: ExportQuality;
  readonly categories: readonly ExportCategory[];
}

/**
 * The exact content a compact semi-prestasi sheet renders, hence what its semantic fingerprint
 * covers: tournament/revision identity plus only its own (semi-prestasi) categories — so changing a
 * prestasi category never changes this document's fingerprint. Both scopes share one subject shape;
 * a revision-scoped sheet additionally covers the quality summary line it prints.
 */
export function semiPrestasiFingerprintSubject(
  model: ExportModel,
  categoryId: string | null,
): SemiPrestasiFingerprintSubject {
  const categories = selectSemiPrestasiCategories(model, categoryId);
  return categoryId === null
    ? { tournament: model.tournament, revision: model.revision, quality: model.quality, categories }
    : { tournament: model.tournament, revision: model.revision, categories };
}
