import { describe, expect, it } from 'vitest';

import {
  EXPORT_TEMPLATE_VERSION,
  exportTemplateVersionFor,
  SEMI_PRESTASI_COMPACT_TEMPLATE_VERSION,
} from './constants.js';
import { computeSemanticExportFingerprint } from './fingerprint.js';
import { selectSemiPrestasiCategories, semiPrestasiFingerprintSubject } from './semi-prestasi.js';
import { makeSemiPrestasiFixtureModel } from './testing/semi-prestasi-fixtures.js';

const build = (prestasiPoolSize = 4) =>
  makeSemiPrestasiFixtureModel([
    { key: 'A-SEMI', discipline: 'KYORUGI', poolSizes: [4, 3] },
    { key: 'B-PRES', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [prestasiPoolSize] },
    { key: 'C-SEMI', discipline: 'POOMSAE', poolSizes: [4] },
  ]);

describe('selectSemiPrestasiCategories', () => {
  it('REVISION scope: only semi-prestasi categories, in the model order', () => {
    const cats = selectSemiPrestasiCategories(build(), null);
    expect(cats.map((c) => c.categoryKey)).toEqual(['A-SEMI', 'C-SEMI']);
  });

  it('CATEGORY scope: exactly that category', () => {
    const model = build();
    const id = model.categories.find((c) => c.categoryKey === 'C-SEMI')?.id ?? '';
    expect(selectSemiPrestasiCategories(model, id).map((c) => c.categoryKey)).toEqual(['C-SEMI']);
  });

  it('refuses a non-semi-prestasi category and an unknown category', () => {
    const model = build();
    const prestasi = model.categories.find((c) => c.categoryKey === 'B-PRES')?.id ?? '';
    expect(() => selectSemiPrestasiCategories(model, prestasi)).toThrow(/not a semi-prestasi category/);
    expect(() => selectSemiPrestasiCategories(model, 'nope')).toThrow(/not found/);
  });

  it('REVISION scope with no semi-prestasi category at all is an error, not an empty document', () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'P', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [4] },
    ]);
    expect(() => selectSemiPrestasiCategories(model, null)).toThrow(/not found/);
  });
});

describe('semiPrestasiFingerprintSubject', () => {
  const fp = (m: ReturnType<typeof build>, id: string | null) =>
    computeSemanticExportFingerprint(semiPrestasiFingerprintSubject(m, id));

  it('is deterministic for the same model', () => {
    expect(fp(build(), null)).toBe(fp(build(), null));
  });

  it('does not change when only a PRESTASI category changes (scope = its own content)', () => {
    expect(fp(build(4), null)).toBe(fp(build(3), null));
  });

  it('changes when a semi-prestasi category changes, and differs per category scope', () => {
    const a = build();
    const b = makeSemiPrestasiFixtureModel([
      { key: 'A-SEMI', discipline: 'KYORUGI', poolSizes: [4, 4] },
      { key: 'B-PRES', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [4] },
      { key: 'C-SEMI', discipline: 'POOMSAE', poolSizes: [4] },
    ]);
    expect(fp(a, null)).not.toBe(fp(b, null));
    const idA = a.categories.find((c) => c.categoryKey === 'A-SEMI')?.id ?? '';
    const idC = a.categories.find((c) => c.categoryKey === 'C-SEMI')?.id ?? '';
    expect(fp(a, idA)).not.toBe(fp(a, idC));
  });
});

describe('exportTemplateVersionFor', () => {
  it('gives the compact sheet its own template version and leaves every other type on v1', () => {
    expect(exportTemplateVersionFor('SEMI_PRESTASI_COMPACT_DRAW_SHEET')).toBe(
      SEMI_PRESTASI_COMPACT_TEMPLATE_VERSION,
    );
    expect(SEMI_PRESTASI_COMPACT_TEMPLATE_VERSION).not.toBe(EXPORT_TEMPLATE_VERSION);
    for (const t of [
      'TOURNAMENT_DRAW_BOOK',
      'CATEGORY_DRAW',
      'POOL_SHEET',
      'BRACKET_SHEET',
      'XLSX_WORKBOOK',
    ]) {
      expect(exportTemplateVersionFor(t)).toBe('v1');
    }
  });
});
