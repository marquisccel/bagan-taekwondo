import type { ExportCategory } from './model.js';

/**
 * Presentation-only Indonesian localization for export documents (final polish pass — the export
 * architecture, lifecycle, fingerprints and persisted domain codes are unchanged; this module only
 * decides how they are WORDED on a rendered PDF/XLSX). Every mapping here is a display concern:
 * the underlying `ExportModel` still carries the raw domain code/enum value untouched, and every
 * formatter in this file is pure and driven only by its input — no I/O, no recomputation of
 * anything the draw engine or persistence layer already decided.
 *
 * One centralized module, reused by every PDF template and the XLSX builder, so a label is never
 * translated two different ways in two different documents.
 */

export const GENDER_LABEL: Readonly<Record<string, string>> = {
  MALE: 'Putra',
  FEMALE: 'Putri',
  MIXED: 'Campuran',
};

export const FORMAT_LABEL: Readonly<Record<string, string>> = {
  INDIVIDUAL: 'Individu',
  PAIR: 'Pasangan',
  TEAM: 'Beregu',
};

export const STREAM_LABEL: Readonly<Record<string, string>> = {
  PRESTASI: 'Prestasi',
  SEMI_PRESTASI: 'Semi Prestasi',
};

export const READINESS_LABEL: Readonly<Record<string, string>> = {
  READY: 'Siap',
  BLOCKED: 'Diblokir',
  PENDING: 'Belum Dimulai',
};

export const MATCH_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING: 'Belum Dimulai',
  WALKOVER: 'Walkover',
  VOID: 'Dibatalkan',
};

export const REVISION_LIFECYCLE_LABEL: Readonly<Record<string, string>> = {
  DRAFT: 'Draf',
  REVIEW: 'Tinjauan',
  APPROVED: 'Disetujui',
  LOCKED: 'Terkunci',
  PUBLISHED: 'Diterbitkan',
  AMENDED: 'Diamendemen',
  SUPERSEDED: 'Digantikan',
};

/** Kyorugi/Poomsae are competition terminology, not translated — only cased for display. */
export const DISCIPLINE_LABEL: Readonly<Record<string, string>> = {
  KYORUGI: 'Kyorugi',
  POOMSAE: 'Poomsae',
};

export const EXPORT_MODE_LABEL: Readonly<Record<'PREVIEW' | 'OFFICIAL', string>> = {
  PREVIEW: 'PREVIEW — BUKAN UNTUK PENGGUNAAN RESMI',
  OFFICIAL: 'DOKUMEN RESMI',
};

/**
 * Human-safe explanations for the frozen Phase 3 engine's reason codes (packages/draw-engine/src/codes.ts,
 * the `POOL`, `BYE` and `FINDING` kinds — the only ones that reach an exported document). Codes are
 * never renamed and never invented here; a code without an explicit entry falls back to
 * `humanizeCode`, which is always a plain, honest rendering of the code itself, never a
 * fabricated explanation.
 */
export const WARNING_LABEL: Readonly<Record<string, string>> = {
  POOL_SIZE_PREFERENCE: 'Ukuran pool sesuai preferensi kebijakan.',
  POOL_RANGE: 'Pool berada pada rentang yang diizinkan kebijakan.',
  POOL_CLOSED_BY_WEIGHT_RANGE: 'Pool ditutup karena mencapai batas rentang berat.',
  POOL_CLOSED_BY_HEIGHT_RANGE: 'Pool ditutup karena mencapai batas rentang tinggi.',
  POOL_CLOSED_BY_BELT_RANGE: 'Pool ditutup karena mencapai batas rentang tingkat sabuk.',
  POOL_CLOSED_BY_SIZE_LIMIT: 'Pool ditutup karena mencapai batas ukuran maksimum.',
  POOL_IS_WHOLE_CATEGORY: 'Pool ini mencakup seluruh peserta pada kategori ini.',
  CATEGORY_HAS_ONE_ENTRY: 'Kategori ini hanya memiliki satu peserta.',
  SINGLETON_WALKOVER: 'Peserta tunggal — ditetapkan sebagai walkover.',
  SINGLETON_NO_COMPATIBLE_PARTNER: 'Peserta tunggal — tidak ditemukan pasangan pool yang sesuai.',
  SINGLE_CONTINGENT_NO_FEASIBLE_SWAP:
    'Seluruh peserta berasal dari satu kontingen — tidak ada pertukaran yang memungkinkan.',
  CATEGORY_SINGLE_CONTINGENT: 'Seluruh peserta kategori ini berasal dari satu kontingen.',
  SAME_CONTINGENT_ROUND1_UNAVOIDABLE: 'Pertemuan sesama kontingen pada babak pertama tidak dapat dihindari.',
  BYE_TO_TOP_RANK: 'BYE diberikan kepada peserta peringkat teratas.',
  BYE_TO_MANUAL_SEED: 'BYE diberikan sesuai unggulan manual.',
  CATEGORY_KEY_UNVERIFIED: 'Kategori memerlukan verifikasi.',
  ENTRY_BLOCKED: 'Peserta diblokir dari kategori ini.',
  SINGLE_CONTINGENT_POOL: 'Pool ini hanya berisi peserta dari satu kontingen.',
  ENTRY_MALFORMED: 'Data peserta tidak valid.',
  INTAKE_DISAGREEMENT: 'Data pendaftaran tidak konsisten dengan sumber intake.',
  CATEGORY_KEY_MISMATCH: 'Ketidaksesuaian kunci kategori.',
  LARGE_BRACKET: 'Bagan berukuran besar.',
};

/** Turns SCREAMING_SNAKE_CASE into "Screaming Snake Case" — an honest fallback, never a fabricated explanation. */
export function humanizeCode(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** The primary operator-facing text for a warning code; the code itself remains available separately for traceability. */
export function warningLabel(code: string): string {
  return WARNING_LABEL[code] ?? humanizeCode(code);
}

export function genderLabel(value: string): string {
  return GENDER_LABEL[value] ?? humanizeCode(value);
}

export function formatLabel(value: string): string {
  return FORMAT_LABEL[value] ?? humanizeCode(value);
}

export function streamLabel(value: string): string {
  return STREAM_LABEL[value] ?? humanizeCode(value);
}

export function readinessLabel(value: string): string {
  return READINESS_LABEL[value] ?? humanizeCode(value);
}

export function matchStatusLabel(value: string): string {
  return MATCH_STATUS_LABEL[value] ?? humanizeCode(value);
}

export function revisionLifecycleLabel(value: string): string {
  return REVISION_LIFECYCLE_LABEL[value] ?? humanizeCode(value);
}

export function disciplineLabel(value: string): string {
  return DISCIPLINE_LABEL[value] ?? humanizeCode(value);
}

/** "-29" -> "-29 kg" (real weight class codes are already "-NN"/"+NN" — see packages/rules/src/schema.ts). */
export function weightClassLabel(code: string): string {
  return `${code} kg`;
}

/**
 * The canonical, single-source formatter for a category's human-readable display title
 * (ACCEPTANCE §2). Used by every PDF template and the XLSX workbook so a category is never titled
 * two different ways. Examples:
 *   "Kyorugi Prestasi — Cadet Putri — -29 kg"
 *   "Kyorugi Semi Prestasi — Pra Cadet C Putra — +53 kg"
 *   "Poomsae Prestasi — Dewasa Campuran — Tunggal"
 * The raw `categoryKey` is never used as a title; it remains available on the category as a
 * separate technical field for metadata/debug/reconciliation purposes.
 */
export function formatCategoryDisplayName(
  category: Pick<
    ExportCategory,
    | 'discipline'
    | 'stream'
    | 'ageDivisionCode'
    | 'ageDivisionLabel'
    | 'gender'
    | 'weightClassCode'
    | 'movement'
  >,
): string {
  const disciplineStream = `${disciplineLabel(category.discipline)} ${streamLabel(category.stream)}`;
  const ageDivision =
    category.ageDivisionLabel ?? (category.ageDivisionCode ? humanizeCode(category.ageDivisionCode) : null);
  const ageGender = [ageDivision, genderLabel(category.gender)].filter(Boolean).join(' ');
  const detail = category.weightClassCode
    ? weightClassLabel(category.weightClassCode)
    : category.movement
      ? humanizeCode(category.movement)
      : null;

  return [disciplineStream, ageGender, detail].filter((part) => part && part.length > 0).join(' — ');
}
