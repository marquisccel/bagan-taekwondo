import type { CommandVerdict } from './api';

/**
 * Indonesian wording for the machine-readable reason codes of a MoveEntry / SwapEntries verdict
 * (packages/draw-engine/src/impact.ts). The server decides WHAT is violated; this only says it.
 */
export const IMPACT_CODE_LABEL: Readonly<Record<string, string>> = {
  // hard (Tier 0) — the command is refused
  POOL_SIZE_EXCEEDED: 'jumlah peserta pool melebihi batas maksimum',
  MEASURE_MISSING: 'data tinggi/berat/sabuk peserta tidak lengkap',
  MAX_TOLERANCE_EXCEEDED: 'selisih tinggi/berat melebihi batas maksimum yang ditetapkan panitia',
  BELT_BAND_MISMATCH: 'sabuk peserta berbeda kelompok dalam satu pool',
  // soft — allowed with a reason
  WEIGHT_TOLERANCE_WORSENED: 'selisih berat badan dalam pool melampaui toleransi ideal',
  HEIGHT_TOLERANCE_WORSENED: 'selisih tinggi badan dalam pool melampaui toleransi ideal',
  BELT_TOLERANCE_WORSENED: 'selisih tingkat sabuk dalam pool melampaui toleransi ideal',
  CONTINGENT_CONCENTRATION_WORSENED: 'peserta dari satu kontingen menjadi lebih menumpuk dalam pool',
  POOL_SIZE_WORSENED: 'ukuran pool menjauhi ukuran yang disarankan',
  SINGLETON_CREATED: 'terbentuk pool berisi satu peserta (walkover)',
};

export const IMPACT_CHANGE_LABEL: Readonly<Record<string, string>> = {
  IMPROVED: 'Kualitas pengelompokan membaik.',
  UNCHANGED: 'Kualitas pengelompokan tidak berubah.',
  WORSE: 'Kualitas pengelompokan menurun.',
};

export const impactCodeLabel = (code: string): string => IMPACT_CODE_LABEL[code] ?? code;

/** "a; b; c" of the labels of `codes` (or a neutral text when the list is empty). */
export function describeImpactCodes(codes: readonly string[]): string {
  return codes.length === 0 ? 'alasan tidak dirinci' : codes.map(impactCodeLabel).join('; ');
}

export function verdictCodes(verdict: CommandVerdict): readonly string[] {
  return verdict.level === 'YELLOW'
    ? verdict.softViolations
    : verdict.level === 'RED'
      ? verdict.hardViolations
      : [];
}
