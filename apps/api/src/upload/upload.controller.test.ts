import { describe, expect, it } from 'vitest';

import { slugify } from './upload.controller';

describe('slugify (tournament.code, for a readable URL segment)', () => {
  it('turns a real SPS title into a readable, hyphenated slug', () => {
    expect(slugify('INDONESIA SUPER FIGHT 4')).toBe('indonesia-super-fight-4');
  });

  it('strips diacritics and non-alphanumeric characters', () => {
    expect(slugify('Piala Gubernur Jawa Timur (2026)!')).toBe('piala-gubernur-jawa-timur-2026');
    expect(slugify('Kejuaraan Séa Games')).toBe('kejuaraan-sea-games');
  });

  it('collapses runs of separators and trims leading/trailing hyphens', () => {
    expect(slugify('  --Kejuaraan   Kota--  ')).toBe('kejuaraan-kota');
  });

  it('falls back to a generic label when nothing alphanumeric survives', () => {
    expect(slugify('！！！')).toBe('turnamen');
    expect(slugify('')).toBe('turnamen');
  });

  it('caps length so an unusually long title never produces an unwieldy uuid-length code', () => {
    const long = 'A'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
});
