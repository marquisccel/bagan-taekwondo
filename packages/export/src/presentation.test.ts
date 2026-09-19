import { describe, expect, it } from 'vitest';

import {
  beltLabel,
  formatCategoryDisplayName,
  formatHeightCm,
  formatWeightKg,
  genderLabel,
  humanizeCode,
  MISSING_VALUE,
  participantCountLabel,
  poolLabel,
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
    expect(beltLabel(null)).toBe('—');
    expect(beltLabel('   ')).toBe('—');
    expect(formatHeightCm(null)).toBe('—');
    expect(formatWeightKg(null)).toBe('—');
  });

  it('turns belt codes into readable Indonesian-friendly labels without inventing colors', () => {
    expect(beltLabel('GEUP_9')).toBe('Geup 9');
    expect(beltLabel('GEUP_10')).toBe('Geup 10');
    expect(beltLabel('HITAM')).toBe('Hitam');
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
