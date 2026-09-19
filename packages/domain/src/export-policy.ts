import type { ExportMode, ExportScopeType, ExportStatus, ExportType, RevisionLifecycle } from './enums.js';

/**
 * Phase 6 lock/publish policy: an OFFICIAL export may only be generated from a revision that is
 * already LOCKED, PUBLISHED, or AMENDED (AMENDED is still the official result until its child
 * publishes — see revision-lifecycle.ts's `isOfficial`). PREVIEW is allowed from any state that
 * still has content to render; a SUPERSEDED revision is a dead branch, never exportable.
 */
const OFFICIAL_LIFECYCLES: ReadonlySet<RevisionLifecycle> = new Set(['LOCKED', 'PUBLISHED', 'AMENDED']);
const EXPORTABLE_LIFECYCLES: ReadonlySet<RevisionLifecycle> = new Set([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'LOCKED',
  'PUBLISHED',
  'AMENDED',
]);

export function canExportInMode(lifecycle: RevisionLifecycle, mode: ExportMode): boolean {
  if (mode === 'OFFICIAL') return OFFICIAL_LIFECYCLES.has(lifecycle);
  return EXPORTABLE_LIFECYCLES.has(lifecycle);
}

/** Export generation state machine: REQUESTED -> GENERATING -> {READY, FAILED}. Mirrors draw_run_guard's shape (Phase 4). */
const EXPORT_TRANSITIONS: Readonly<Record<ExportStatus, ReadonlySet<ExportStatus>>> = {
  REQUESTED: new Set(['GENERATING']),
  GENERATING: new Set(['READY', 'FAILED']),
  READY: new Set([]),
  FAILED: new Set([]),
};

export function exportTransitionAllowed(from: ExportStatus, to: ExportStatus): boolean {
  return EXPORT_TRANSITIONS[from].has(to);
}

/**
 * Which scope an export request covers (the API controller's single source of truth — it never
 * decides this itself). Fixed per type, with one deliberate exception: the compact semi-prestasi
 * draw sheet is category-scoped when a category is named and revision-scoped (every semi-prestasi
 * category of the revision in one document) when it is not.
 */
export function exportScopeFor(exportType: ExportType, hasCategoryId: boolean): ExportScopeType {
  switch (exportType) {
    case 'CATEGORY_DRAW':
      return 'CATEGORY';
    case 'POOL_SHEET':
    case 'BRACKET_SHEET':
      return 'POOL';
    case 'SEMI_PRESTASI_COMPACT_DRAW_SHEET':
      return hasCategoryId ? 'CATEGORY' : 'REVISION';
    case 'TOURNAMENT_DRAW_BOOK':
    case 'XLSX_WORKBOOK':
      return 'REVISION';
  }
}

/** Export types whose document only ever contains `category.stream === 'SEMI_PRESTASI'` categories. */
export function isSemiPrestasiOnlyExport(exportType: ExportType): boolean {
  return exportType === 'SEMI_PRESTASI_COMPACT_DRAW_SHEET';
}

/** XLSX is only ever produced by the workbook type; every other export type is a PDF. */
export function exportFormatFor(exportType: ExportType): 'PDF' | 'XLSX' {
  return exportType === 'XLSX_WORKBOOK' ? 'XLSX' : 'PDF';
}
