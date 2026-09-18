import { describe, expect, it } from 'vitest';

import {
  formatCategoryDisplayName,
  genderLabel,
  humanizeCode,
  readinessLabel,
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
