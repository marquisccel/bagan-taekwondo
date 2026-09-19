/** Bumped whenever a PDF/XLSX template's visual structure changes in a way that should invalidate reuse/caching. */
export const EXPORT_TEMPLATE_VERSION = 'v1';

/**
 * Template version of the dense semi-prestasi tournament-desk sheet (AUD-012) — versioned on its
 * own so re-designing that one template never invalidates the fingerprints of the older documents.
 */
export const SEMI_PRESTASI_COMPACT_TEMPLATE_VERSION = 'semi-compact-v1';

/** The template version recorded in `export_artifact.template_version` / the parameters fingerprint. */
export function exportTemplateVersionFor(exportType: string): string {
  return exportType === 'SEMI_PRESTASI_COMPACT_DRAW_SHEET'
    ? SEMI_PRESTASI_COMPACT_TEMPLATE_VERSION
    : EXPORT_TEMPLATE_VERSION;
}
