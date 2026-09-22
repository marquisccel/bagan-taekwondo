import { describe, expect, it } from 'vitest';

import {
  beltDisplay,
  formatCategoryDisplayName,
  formatHeightCm,
  formatWeightKg,
  genderLabel,
  humanizeCode,
  MISSING_VALUE,
  participantCountLabel,
  poolLabel,
  qualitySummaryLabel,
  readinessLabel,
  SEMI_PRESTASI_COMPACT_LABEL,
  warningLabel,
} from './presentation.js';

describe('presentation labels (final polish pass)', () => {
  it('translates the required enum values into Indonesian', () => {
    expect(genderLabel('MALE')).toBe('Putra');
    expect(genderLabel('FEMALE')).toBe('Putri');
    expect(genderLabel('MIXED')).toBe('Campuran');
    expect(readinessLabel('READY')).toBe('Siap');
    expect(readinessLabel('BLOCKED')).toBe('Diblokir');
  });

  it('never shows a raw enum value for a mapped code — always the Indonesian label', () => {
    for (const raw of ['MALE', 'FEMALE', 'MIXED']) {
      expect(genderLabel(raw)).not.toBe(raw);
    }
  });

  it('falls back to an honest humanized rendering for an unmapped code, never inventing an explanation', () => {
    expect(humanizeCode('SOME_NEW_CODE')).toBe('Some New Code');
    expect(warningLabel('SOME_NEW_CODE')).toBe('Some New Code');
  });

  it('gives every known Phase 3 pool/finding reason code an Indonesian human explanation', () => {
    expect(warningLabel('SINGLETON_WALKOVER')).toBe('Peserta tunggal — ditetapkan sebagai walkover.');
    expect(warningLabel('POOL_IS_WHOLE_CATEGORY')).toBe(
      'Pool ini mencakup seluruh peserta pada kategori ini.',
    );
    expect(warningLabel('CATEGORY_KEY_UNVERIFIED')).toBe('Kategori memerlukan verifikasi.');
  });

  it('formats a category display name from discipline/stream/age/gender/weight, never the raw category key', () => {
    const name = formatCategoryDisplayName({
      discipline: 'KYORUGI',
      stream: 'PRESTASI',
      ageDivisionCode: 'CADET',
      ageDivisionLabel: 'Cadet',
      gender: 'FEMALE',
      weightClassCode: '-29',
      movement: null,
    });
    expect(name).toBe('Kyorugi Prestasi — Cadet Putri — -29 kg');
    expect(name).not.toContain('|');
    expect(name).not.toContain('STREAM=');
  });

  it('matches the semi-prestasi example from the spec exactly', () => {
    const name = formatCategoryDisplayName({
      discipline: 'KYORUGI',
      stream: 'SEMI_PRESTASI',
      ageDivisionCode: 'PRA_CADET_C',
      ageDivisionLabel: 'Pra Cadet C',
      gender: 'MALE',
      weightClassCode: '+53',
      movement: null,
    });
    expect(name).toBe('Kyorugi Semi Prestasi — Pra Cadet C Putra — +53 kg');
  });

  it('falls back to a humanized age division code when no curated label is available', () => {
    const name = formatCategoryDisplayName({
      discipline: 'POOMSAE',
      stream: 'PRESTASI',
      ageDivisionCode: 'DEWASA',
      ageDivisionLabel: null,
      gender: 'MIXED',
      weightClassCode: null,
      movement: 'TUNGGAL',
    });
    expect(name).toBe('Poomsae Prestasi — Dewasa Campuran — Tunggal');
  });

  it('does not translate Kyorugi/Poomsae/BYE — only cases them for display', () => {
    expect(
      formatCategoryDisplayName({
        discipline: 'KYORUGI',
        stream: 'PRESTASI',
        ageDivisionCode: null,
        ageDivisionLabel: null,
        gender: 'MALE',
        weightClassCode: null,
        movement: null,
      }),
    ).toContain('Kyorugi');
  });
});

describe('compact semi-prestasi sheet labels (AUD-012)', () => {
  it('shows "—" for a missing belt/height/weight, never a guessed value', () => {
    expect(MISSING_VALUE).toBe('—');
    expect(beltDisplay(null)).toBe('—');
    expect(beltDisplay('   ')).toBe('—');
    expect(formatHeightCm(null)).toBe('—');
    expect(formatWeightKg(null)).toBe('—');
  });

  it('falls back to a humanized code (never a guessed color) when no curated rule-set label is on file', () => {
    expect(beltDisplay('GEUP_9')).toBe('Geup 9');
    expect(beltDisplay('GEUP_9', null)).toBe('Geup 9');
    expect(beltDisplay('GEUP_10')).toBe('Geup 10');
    expect(beltDisplay('HITAM')).toBe('Hitam');
  });

  it('shows the belt COLOR alone when the curated rule-set label has that shape (ACCEPTANCE §6, final polish) — never a raw GEUP_N code or the rank prefix', () => {
    expect(beltDisplay('GEUP_9', 'Geup 9 (kuning)')).toBe('Kuning');
    expect(beltDisplay('GEUP_8', 'Geup 8 (kuning strip hijau)')).toBe('Kuning Strip Hijau');
    expect(beltDisplay('GEUP_6', 'Geup 6 (hijau strip biru)')).toBe('Hijau Strip Biru');
    expect(beltDisplay('DAN_1', 'Dan 1 (hitam)')).toBe('Hitam');
    expect(beltDisplay('GEUP_9', 'Geup 9 (kuning)')).not.toContain('GEUP_9');
    expect(beltDisplay('GEUP_9', 'Geup 9 (kuning)')).not.toContain('Geup');
    expect(beltDisplay('GEUP_9', '  ')).toBe('Geup 9'); // blank label degrades to the code, not blank text
  });

  it('falls back to the whole curated label, title-cased, when it does not have the "<rank> (<color>)" shape', () => {
    expect(beltDisplay('GEUP_9', 'Kuning')).toBe('Kuning');
    expect(beltDisplay('GEUP_9', 'sabuk kuning')).toBe('Sabuk Kuning');
  });

  it('has one shared "N error, M peringatan" line for draw quality, omitting zero-count levels', () => {
    expect(qualitySummaryLabel({ errorCount: 0, warningCount: 0, infoCount: 0, findings: [] })).toBeNull();
    expect(qualitySummaryLabel({ errorCount: 1, warningCount: 3, infoCount: 0, findings: [] })).toBe(
      'Kualitas draw: 1 error, 3 peringatan',
    );
    expect(qualitySummaryLabel({ errorCount: 0, warningCount: 0, infoCount: 5, findings: [] })).toBe(
      'Kualitas draw: 5 info',
    );
  });

  it('converts persisted mm/g to cm/kg with an Indonesian decimal comma', () => {
    expect(formatHeightCm(1650)).toBe('165');
    expect(formatHeightCm(1655)).toBe('165,5');
    expect(formatHeightCm(734)).toBe('73,4');
    expect(formatWeightKg(40000)).toBe('40');
    expect(formatWeightKg(40250)).toBe('40,25');
    expect(formatWeightKg(40500)).toBe('40,5');
    expect(formatWeightKg(0)).toBe('0');
  });

  it('has standardized Indonesian labels for every printed column', () => {
    const l = SEMI_PRESTASI_COMPACT_LABEL;
    expect(l.documentTitle).toBe('Lembar Drawing Ringkas Semi Prestasi');
    expect([l.participantName, l.belt, l.heightCm, l.weightKg, l.contingent, l.movement, l.format]).toEqual([
      'Nama peserta',
      'Sabuk',
      'TB (cm)',
      'BB (kg)',
      'Kontingen',
      'Gerakan',
      'Format',
    ]);
    expect(poolLabel(3)).toBe('Pool 3');
    expect(participantCountLabel(4)).toBe('4 peserta');
  });
});
