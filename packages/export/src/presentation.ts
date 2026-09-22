import type { ExportCategory, ExportQuality } from './model.js';

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
  PREVIEW: 'PREVIEW · BUKAN UNTUK PENGGUNAAN RESMI',
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
 * The operator-facing weight-class label (table-refinement pass): the canonical rule set only ever
 * defines a weight class as "-NN" (an upper-bound-only class) or "+NN" (a lower-bound-only class —
 * see the `/^[-+]\d+$/` schema in packages/rules/src/schema.ts; there is no third, bounded-range
 * form in this domain). Never mutates or reinterprets the canonical code — `-41` always means
 * "at most 41kg" and is shown "Under 41 kg"; `+78` always means "over 78kg" and is shown
 * "Over 78 kg". A code outside that shape (should not occur for a real rule set) degrades to the
 * plain `weightClassLabel` form rather than inventing a reading of it.
 */
export function weightClassDisplayLabel(code: string): string {
  const m = /^([-+])(\d+)$/.exec(code);
  if (!m) return weightClassLabel(code);
  return m[1] === '-' ? `Under ${m[2]} kg` : `Over ${m[2]} kg`;
}

type CategoryTitleShape = Pick<
  ExportCategory,
  'discipline' | 'stream' | 'ageDivisionCode' | 'ageDivisionLabel' | 'gender' | 'weightClassCode' | 'movement'
>;

/** Shared composition for both title formatters below — only the weight-class wording and the join separator differ. */
function categoryTitleParts(
  category: CategoryTitleShape,
  weightLabel: (code: string) => string,
): readonly [string, string, string | null] {
  const disciplineStream = `${disciplineLabel(category.discipline)} ${streamLabel(category.stream)}`;
  const ageDivision =
    category.ageDivisionLabel ?? (category.ageDivisionCode ? humanizeCode(category.ageDivisionCode) : null);
  const ageGender = [ageDivision, genderLabel(category.gender)].filter(Boolean).join(' ');
  const detail = category.weightClassCode
    ? weightLabel(category.weightClassCode)
    : category.movement
      ? humanizeCode(category.movement)
      : null;
  return [disciplineStream, ageGender, detail];
}

/**
 * The canonical, single-source formatter for a category's human-readable display title
 * (ACCEPTANCE §2). Used by CATEGORY_DRAW, TOURNAMENT_DRAW_BOOK and the XLSX workbook so those
 * documents are never titled two different ways. Examples:
 *   "Kyorugi Prestasi — Cadet Putri — -29 kg"
 *   "Kyorugi Semi Prestasi — Pra Cadet C Putra — +53 kg"
 *   "Poomsae Prestasi — Dewasa Campuran — Tunggal"
 * The raw `categoryKey` is never used as a title; it remains available on the category as a
 * separate technical field for metadata/debug/reconciliation purposes.
 */
export function formatCategoryDisplayName(category: CategoryTitleShape): string {
  return categoryTitleParts(category, weightClassLabel)
    .filter((part) => part && part.length > 0)
    .join(' — ');
}

/**
 * The dense operational documents' category title (table-refinement pass, item 1): the same three
 * parts as `formatCategoryDisplayName`, but joined with a middle dot instead of an em dash and
 * using the human weight-class phrasing ("Under 41 kg") instead of the raw "-41 kg" notation.
 * Reuses `categoryTitleParts` rather than a second parallel implementation, so the two formatters
 * can never drift apart on anything but wording/punctuation. Used by
 * SEMI_PRESTASI_COMPACT_DRAW_SHEET, POOL_SHEET and BRACKET_SHEET only — CATEGORY_DRAW and
 * TOURNAMENT_DRAW_BOOK keep `formatCategoryDisplayName` as their audit-style title. Example:
 *   "Kyorugi Semi Prestasi · Pra Cadet C Putra · Under 41 kg"
 */
export function formatOperatorCategoryTitle(category: CategoryTitleShape): string {
  return categoryTitleParts(category, weightClassDisplayLabel)
    .filter((part) => part && part.length > 0)
    .join(' · ');
}

// ---------------------------------------------------------------------------------------
// Compact semi-prestasi draw sheet (AUD-012) — display helpers. Same rule as everything above:
// pure, driven only by the persisted value, never inventing one that is missing.
// ---------------------------------------------------------------------------------------

/**
 * Shown wherever a persisted value (belt, height, weight, ...) is absent — never a guessed default.
 * An en dash, not an em dash (table refinement pass, item 1): the em dash is reserved for nothing in
 * these documents now, so this stays visually distinct from the middle-dot structural separator
 * while still reading as "no data" rather than a real value.
 */
export const MISSING_VALUE = '–';

export const SEMI_PRESTASI_COMPACT_LABEL = {
  documentTitle: 'Lembar Drawing Ringkas Semi Prestasi',
  pool: 'Pool',
  participant: 'Peserta',
  participantName: 'Nama peserta',
  contingent: 'Kontingen',
  belt: 'Sabuk',
  heightCm: 'Tinggi Badan',
  weightKg: 'Berat Badan',
  number: 'No',
  movement: 'Gerakan',
  format: 'Format',
  category: 'Kategori',
  matchCode: 'Kode',
  walkover: 'Walkover',
  bye: 'BYE',
  final: 'FINAL',
  noBracket: 'Tanpa bagan pertandingan.',
  bracketTooLarge: 'Bagan berukuran besar. Lihat dokumen Bagan Pertandingan untuk diagram lengkap.',
  noPools: 'Belum ada pool.',
  noParticipants: 'Tidak ada peserta',
  noCategories: 'Tidak ada kategori semi prestasi pada revisi ini.',
  incompleteData: 'Data belum lengkap',
} as const;

/** "geup 9 (kuning)" -> "Geup 9 (Kuning)" — capitalizes every word, including inside parentheses. */
function titleCaseWords(s: string): string {
  return s.replace(/\p{L}[\p{L}'-]*/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * The rule set's curated belt label is "<rank> (<color phrase>)", e.g. "Geup 9 (kuning)" or
 * "Dan 1 (hitam)" — real tournament/rule data (`rule_belt.label`), never invented here. Returns the
 * trailing parenthetical (the color phrase) when the label has that shape, null otherwise, so the
 * caller can fall back gracefully to the label as a whole.
 */
function beltColorPhrase(label: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(label.trim());
  return m?.[1]?.trim() || null;
}

/**
 * The operator-facing belt label. Never a raw persisted code such as `GEUP_6` (ACCEPTANCE §6). For
 * the dense operational documents (compact sheet, pool sheet, bracket sheet) the short, primary form
 * is the belt COLOR alone ("Kuning", "Kuning Strip Hijau"), extracted from the rule set's own curated
 * label — never an invented color mapping. If the curated label doesn't have the expected
 * "<rank> (<color>)" shape, the whole label is shown title-cased instead of dropping it. Absent a
 * curated label entirely (older snapshots, synthetic fixtures), degrades gracefully to a plain
 * humanized rendering of the code ("GEUP_9" -> "Geup 9"), and to "—" when there is no code at all.
 */
export function beltDisplay(beltCode: string | null, beltLabel?: string | null): string {
  if (beltLabel && beltLabel.trim().length > 0) {
    const trimmed = beltLabel.trim();
    return titleCaseWords(beltColorPhrase(trimmed) ?? trimmed);
  }
  return beltCode && beltCode.trim().length > 0 ? humanizeCode(beltCode.trim()) : MISSING_VALUE;
}

const decimalId = (value: number, digits: number): string =>
  Number(value.toFixed(digits)).toString().replace('.', ',');

/** Persisted height is in mm; sheets show cm ("1655" -> "165,5"). Null -> the missing-value marker. */
export function formatHeightCm(heightMm: number | null): string {
  return heightMm === null ? MISSING_VALUE : decimalId(heightMm / 10, 1);
}

/** Persisted weight is in grams; sheets show kg ("40250" -> "40,25"). Null -> the missing-value marker. */
export function formatWeightKg(weightG: number | null): string {
  return weightG === null ? MISSING_VALUE : decimalId(weightG / 1000, 2);
}

/**
 * The operator-facing height VALUE, unit included ("165,5 cm") -- the "Tinggi Badan"/"Berat Badan"
 * column headers no longer carry the unit themselves (visual polish pass), so each cell states its
 * own unit instead. Never appends a unit to the missing-value marker.
 */
export function heightCmDisplay(heightMm: number | null): string {
  const v = formatHeightCm(heightMm);
  return v === MISSING_VALUE ? v : `${v} cm`;
}

/** The operator-facing weight VALUE, unit included ("40,25 kg") -- see `heightCmDisplay`. */
export function weightKgDisplay(weightG: number | null): string {
  const v = formatWeightKg(weightG);
  return v === MISSING_VALUE ? v : `${v} kg`;
}

export function poolLabel(ordinal: number): string {
  return `Pool ${ordinal}`;
}

export function participantCountLabel(count: number): string {
  return `${count} peserta`;
}

/**
 * One shared "N error, M peringatan[, K info]" line for a revision's draw quality — used by every
 * audit-oriented document (Laporan Analisis Drawing, the compact sheet's revision-scope summary) so
 * it is never worded two different ways. Zero-count levels are omitted; returns `null` when there is
 * nothing to report at all, so a caller can skip the line entirely rather than print "0 error".
 */
export function qualitySummaryLabel(quality: ExportQuality): string | null {
  const parts: string[] = [];
  if (quality.errorCount > 0) parts.push(`${quality.errorCount} error`);
  if (quality.warningCount > 0) parts.push(`${quality.warningCount} peringatan`);
  if (quality.infoCount > 0) parts.push(`${quality.infoCount} info`);
  return parts.length > 0 ? `Kualitas draw: ${parts.join(', ')}` : null;
}
