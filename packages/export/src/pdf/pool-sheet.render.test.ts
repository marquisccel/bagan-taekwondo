import { describe, expect, it } from 'vitest';

import { makeSemiPrestasiFixtureModel } from '../testing/semi-prestasi-fixtures.js';
import type { RenderOptions } from './layout.js';
import { renderPoolSheetPdf } from './pool-sheet.js';

const previewOpts: RenderOptions = {
  mode: 'PREVIEW',
  generatedAt: '2026-08-27T10:00:00Z',
  verificationCode: 'abc123def456',
};
const officialOpts: RenderOptions = { ...previewOpts, mode: 'OFFICIAL' };

describe('POOL_SHEET rendering (headless Chromium)', () => {
  it('renders a well-formed PDF for both PREVIEW and OFFICIAL, for Kyorugi and Poomsae', async () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'K', discipline: 'KYORUGI', poolSizes: [3] },
      { key: 'P', discipline: 'POOMSAE', poolSizes: [3], movement: 'TAEGEUK_1' },
    ]);
    for (const category of model.categories) {
      const pool = category.pools[0]!;
      for (const opts of [previewOpts, officialOpts]) {
        const pdf = await renderPoolSheetPdf(model, pool.id, opts);
        expect(pdf.byteLength).toBeGreaterThan(500);
        expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
      }
    }
  });
});
