import { describe, expect, it } from 'vitest';

import { makeSemiPrestasiFixtureModel } from '../testing/semi-prestasi-fixtures.js';
import type { RenderOptions } from './layout.js';
import { buildPoolSheetHtml } from './pool-sheet.js';

const previewOpts: RenderOptions = {
  mode: 'PREVIEW',
  generatedAt: '2026-08-27T10:00:00Z',
  verificationCode: 'abc123def456',
};
const officialOpts: RenderOptions = { ...previewOpts, mode: 'OFFICIAL' };

describe('POOL_SHEET official privacy (PDF Presentation Remediation)', () => {
  it('PREVIEW shows Sabuk/Tinggi Badan/Berat Badan for a Kyorugi pool', () => {
    const model = makeSemiPrestasiFixtureModel([{ key: 'K', discipline: 'KYORUGI', poolSizes: [3] }]);
    const pool = model.categories[0]!.pools[0]!;
    const { html } = buildPoolSheetHtml(model, pool.id, previewOpts);
    expect(html).toContain('>Sabuk<');
    expect(html).toContain('>Tinggi Badan<');
    expect(html).toContain('>Berat Badan<');
    expect(html).toContain('Kuning');
  });

  it('FINAL/OFFICIAL hides Sabuk/Tinggi Badan/Berat Badan for a Kyorugi pool, keeping No./Peserta/Kontingen', () => {
    const model = makeSemiPrestasiFixtureModel([{ key: 'K', discipline: 'KYORUGI', poolSizes: [3] }]);
    const pool = model.categories[0]!.pools[0]!;
    const { html } = buildPoolSheetHtml(model, pool.id, officialOpts);
    expect(html).not.toContain('>Sabuk<');
    expect(html).not.toContain('>Tinggi Badan<');
    expect(html).not.toContain('>Berat Badan<');
    expect(html).not.toContain('>Kuning<');
    expect(html).toContain('>Posisi<');
    expect(html).toContain('>Peserta<');
    expect(html).toContain('>Kontingen<');
  });

  it('FINAL/OFFICIAL hides Sabuk for a Poomsae pool but keeps Gerakan/Format/Jenis Kelamin', () => {
    const model = makeSemiPrestasiFixtureModel([
      { key: 'P', discipline: 'POOMSAE', poolSizes: [3], movement: 'TAEGEUK_1' },
    ]);
    const pool = model.categories[0]!.pools[0]!;
    const { html } = buildPoolSheetHtml(model, pool.id, officialOpts);
    expect(html).not.toContain('>Sabuk<');
    expect(html).toContain('Taegeuk 1');
    expect(html).toContain('>Jenis Kelamin<');
  });

  it('FINAL/OFFICIAL numbering is sequential (Posisi column), never a raw entry id', () => {
    const model = makeSemiPrestasiFixtureModel([{ key: 'K', discipline: 'KYORUGI', poolSizes: [3] }]);
    const pool = model.categories[0]!.pools[0]!;
    const { html } = buildPoolSheetHtml(model, pool.id, officialOpts);
    expect(html).toMatch(/<td class="num">1<\/td>/);
    expect(html).toMatch(/<td class="num">2<\/td>/);
    expect(html).toMatch(/<td class="num">3<\/td>/);
    for (const e of pool.members) expect(html).not.toContain(e.id);
  });
});
