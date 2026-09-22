import { describe, expect, it } from 'vitest';

import { makeSemiPrestasiFixtureModel } from '../testing/semi-prestasi-fixtures.js';
import type { RenderOptions } from './layout.js';
import { renderSemiPrestasiCompactDrawSheetPdf } from './semi-prestasi-compact.js';

const opts: RenderOptions = {
  mode: 'PREVIEW',
  generatedAt: '2026-08-27T10:00:00Z',
  verificationCode: 'abc123def456',
};

function isWellFormedPdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.slice(0, 8)).toString('latin1');
  const tail = Buffer.from(bytes.slice(-32)).toString('latin1');
  return head.startsWith('%PDF-') && tail.includes('%%EOF');
}

function pageCount(bytes: Uint8Array): number {
  return (
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type\s*\/Page[^s]/g)?.length ?? 0
  );
}

describe('SEMI_PRESTASI_COMPACT_DRAW_SHEET rendering (headless Chromium)', () => {
  for (const n of [1, 2, 3, 4, 5, 7, 8]) {
    it(`renders a Kyorugi semi-prestasi category with a ${n}-participant pool on exactly one page`, async () => {
      const model = makeSemiPrestasiFixtureModel([
        { key: 'K', discipline: 'KYORUGI', poolSizes: [n], walkoverPools: n === 1 ? [0] : [] },
      ]);
      const pdf = await renderSemiPrestasiCompactDrawSheetPdf(model, opts, 'c1');
      expect(isWellFormedPdf(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(500);
      expect(pageCount(pdf)).toBe(1);
    });
  }

  it('packs a multi-pool category densely: 12 pools of 4 fit on 2 pages, deterministically', async () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'M', discipline: 'KYORUGI', poolSizes: Array.from({ length: 12 }, () => 4) },
    ]);
    const first = await renderSemiPrestasiCompactDrawSheetPdf(model, opts, 'c1');
    const second = await renderSemiPrestasiCompactDrawSheetPdf(model, opts, 'c1');
    expect(isWellFormedPdf(first)).toBe(true);
    expect(pageCount(first)).toBe(2);
    expect(pageCount(second)).toBe(pageCount(first));
  });

  it('renders a Poomsae category (movement + format) and a Poomsae pair category on one page each', async () => {
    const individual = makeSemiPrestasiFixtureModel([
      { key: 'P', discipline: 'POOMSAE', poolSizes: [4, 4, 3], movement: 'TAEGEUK_1' },
    ]);
    const pair = makeSemiPrestasiFixtureModel([
      { key: 'PP', discipline: 'POOMSAE', format: 'PAIR', poolSizes: [2, 4], gender: 'MIXED' },
    ]);
    const [a, b] = await Promise.all([
      renderSemiPrestasiCompactDrawSheetPdf(individual, opts, 'c1'),
      renderSemiPrestasiCompactDrawSheetPdf(pair, opts, 'c1'),
    ]);
    expect(isWellFormedPdf(a)).toBe(true);
    expect(isWellFormedPdf(b)).toBe(true);
    expect(pageCount(a)).toBe(1);
    expect(pageCount(b)).toBe(1);
  });

  it('renders a REVISION-scope document of several semi-prestasi categories (a prestasi one is excluded) with long names and missing data', async () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'K1', discipline: 'KYORUGI', poolSizes: [4, 4, 3, 2] },
      { key: 'K2', discipline: 'KYORUGI', weightClassCode: '-45', gender: 'FEMALE', poolSizes: [5, 8, 16] },
      {
        key: 'K3',
        discipline: 'KYORUGI',
        weightClassCode: '+53',
        poolSizes: [4, 4],
        longNames: true,
        missing: { height: true, weight: true, belt: true },
      },
      { key: 'P1', discipline: 'POOMSAE', poolSizes: [4, 4], movement: 'TAEGEUK_1' },
      { key: 'X', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [4] },
    ]);
    const pdf = await renderSemiPrestasiCompactDrawSheetPdf(model, opts, null);
    expect(isWellFormedPdf(pdf)).toBe(true);
    // Landscape (PDF Presentation Remediation §3) trades page height for width: a page fits fewer
    // rows of the largest cards (this fixture deliberately includes an unusually large 16-slot
    // bracket and a long-name stress case), so the safe upper bound is one page more than before.
    expect(pageCount(pdf)).toBeLessThanOrEqual(5);
  });

  it('a bracket too large for a card still renders (a note defers to the bracket sheet)', async () => {
    const model = makeSemiPrestasiFixtureModel([{ key: 'B', discipline: 'KYORUGI', poolSizes: [40] }]);
    const pdf = await renderSemiPrestasiCompactDrawSheetPdf(model, opts, 'c1');
    expect(isWellFormedPdf(pdf)).toBe(true);
    // A 40-participant pool's table alone is taller than one page, so it fragments — but never clips.
    // Final polish §1: some belt colors are two words ("Kuning Strip Hijau") and wrap to a second
    // line in the fixed-width belt column, for those rows only — a modest, bounded consequence of
    // showing the real curated color name instead of the old, always-short "Geup N", not uncontrolled
    // growth (every belt value wraps to at most 2 lines). Across 40 rows that adds one more page.
    expect(pageCount(pdf)).toBe(3);
  });

  it('PREVIEW and OFFICIAL produce different documents; a non-semi-prestasi category is refused', async () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'K', discipline: 'KYORUGI', poolSizes: [4] },
      { key: 'X', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [4], weightClassCode: '-99' },
    ]);
    const preview = await renderSemiPrestasiCompactDrawSheetPdf(model, { ...opts, mode: 'PREVIEW' }, 'c1');
    const official = await renderSemiPrestasiCompactDrawSheetPdf(model, { ...opts, mode: 'OFFICIAL' }, 'c1');
    expect(Buffer.from(preview).equals(Buffer.from(official))).toBe(false);
    await expect(renderSemiPrestasiCompactDrawSheetPdf(model, opts, 'c2')).rejects.toThrow(
      /not a semi-prestasi category/,
    );
  });
});
