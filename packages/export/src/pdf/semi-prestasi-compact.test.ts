import { describe, expect, it } from 'vitest';

import { makeSemiPrestasiFixtureModel, type SemiFixtureCategory } from '../testing/semi-prestasi-fixtures.js';
import { renderCompactBracketSvg } from './compact-bracket-svg.js';
import type { RenderOptions } from './layout.js';
import { buildSemiPrestasiCompactSheetHtml } from './semi-prestasi-compact.js';

const opts: RenderOptions = {
  mode: 'PREVIEW',
  generatedAt: '2026-08-27T10:00:00Z',
  verificationCode: 'abc123def456',
};

const specs: readonly SemiFixtureCategory[] = [
  {
    key: 'K-RAW-KEY-|-STREAM=SEMI',
    discipline: 'KYORUGI',
    poolSizes: [4, 3],
    poolWarnings: [['POOL_CLOSED_BY_SIZE_LIMIT'], []],
  },
  {
    key: 'K-MISSING',
    discipline: 'KYORUGI',
    weightClassCode: '-30',
    poolSizes: [2],
    missing: { belt: true, height: true, weight: true },
  },
  { key: 'P-RAW-KEY', discipline: 'POOMSAE', poolSizes: [4], movement: 'TAEGEUK_1' },
  { key: 'P-PAIR', discipline: 'POOMSAE', format: 'PAIR', poolSizes: [2], gender: 'FEMALE' },
  { key: 'X-PRESTASI', discipline: 'KYORUGI', stream: 'PRESTASI', poolSizes: [4], weightClassCode: '-99' },
];
const model = makeSemiPrestasiFixtureModel(specs);
const idOf = (key: string): string => model.categories.find((c) => c.categoryKey === key)?.id ?? '';

const build = (o: Partial<RenderOptions> = {}, categoryId: string | null = null) =>
  buildSemiPrestasiCompactSheetHtml(model, { ...opts, ...o }, categoryId);

describe('semi-prestasi compact sheet HTML (AUD-012)', () => {
  it('is titled and labelled in Indonesian, with the standard metadata block', () => {
    const { html, title } = build();
    expect(title).toContain('Lembar Drawing Ringkas Semi Prestasi');
    expect(html).toContain('<html lang="id">');
    for (const label of [
      '>Peserta<',
      'Sabuk',
      'TB (cm)',
      'BB (kg)',
      'Kontingen',
      'Pool 1',
      'Revisi 3',
      'Status: Diterbitkan',
      'Dibuat:',
      'Kode verifikasi: abc123def456',
      'PREVIEW — BUKAN UNTUK PENGGUNAAN RESMI',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('OFFICIAL mode has the official label and no PREVIEW watermark', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    expect(html).toContain('DOKUMEN RESMI');
    expect(html).not.toContain('PREVIEW');
    expect(html).not.toContain('class="watermark"');
    expect(build().html).toContain('class="watermark"');
  });

  it('headings use the canonical display name, never the raw category key', () => {
    const { html } = build();
    expect(html).toContain('<h2>Kyorugi Semi Prestasi — Pra Cadet C Putra — -41 kg</h2>');
    expect(html).toContain('<h2>Poomsae Semi Prestasi — Pra Cadet C Putra — Taegeuk 1</h2>');
    expect(html).not.toContain('K-RAW-KEY');
    expect(html).not.toContain('P-RAW-KEY');
    expect(html).not.toContain('STREAM=');
  });

  it('only semi-prestasi categories appear (REVISION scope)', () => {
    const { html } = build();
    expect(html).not.toContain('-99 kg');
    expect(html.match(/<div class="cat-head">/g)).toHaveLength(4);
  });

  it('CATEGORY scope covers just that category and refuses a non-semi-prestasi one', () => {
    const one = build({}, idOf('K-MISSING'));
    expect(one.html.match(/<div class="cat-head">/g)).toHaveLength(1);
    expect(one.html).toContain('Kyorugi Semi Prestasi — Pra Cadet C Putra — -30 kg');
    expect(one.headerTitle).toContain('-30 kg');
    expect(() => build({}, idOf('X-PRESTASI'))).toThrow(/not a semi-prestasi category/);
  });

  it('prints "—" for a missing belt/height/weight and flags the gap in Indonesian', () => {
    const { html } = build({}, idOf('K-MISSING'));
    expect(html.match(/<td class="num na">—<\/td>/g)).toHaveLength(6); // 2 participants x belt/height/weight
    expect(html).toContain('Data belum lengkap: sabuk, tinggi badan, berat badan.');
  });

  it('prints present values converted to cm/kg with the belt label', () => {
    const { html } = build();
    expect(html).toContain('Geup 9');
    expect(html).toContain('>142<'); // 1420 mm -> 142 cm
    expect(html).toContain('>34<'); // 34000 g -> 34 kg
    expect(html).toContain('35,5');
  });

  it("uses the rule set's own curated belt label when the model carries one, never the raw GEUP_N code", () => {
    const base = makeSemiPrestasiFixtureModel([{ key: 'BL', discipline: 'KYORUGI', poolSizes: [2] }]);
    const labelled = {
      ...base,
      categories: base.categories.map((c) => ({
        ...c,
        pools: c.pools.map((p) => ({
          ...p,
          members: p.members.map((e) => ({
            ...e,
            athletes: e.athletes.map((a) => ({ ...a, beltLabel: 'Geup 9 (kuning)' })),
          })),
        })),
      })),
    };
    const { html } = buildSemiPrestasiCompactSheetHtml(labelled, opts, null);
    expect(html).toContain('Geup 9 (Kuning)');
    expect(html).not.toContain('GEUP_9');
  });

  it('never shows a raw engine reason code — pool warnings are an audit (CATEGORY_DRAW) concern, not operational', () => {
    const { html } = build();
    expect(html).not.toContain('POOL_CLOSED_BY_SIZE_LIMIT');
    expect(html).not.toContain('POOL_SIZE_PREFERENCE');
    expect(html).not.toContain('POOL_RANGE');
    expect(html).not.toContain('POOL_CONTINGENT_MIX');
    expect(html).not.toContain('class="code-tag"');
    // the persisted warning itself is untouched on the model — only this operational document hides it
    const raw = model.categories.find((c) => c.categoryKey === 'K-RAW-KEY-|-STREAM=SEMI');
    expect(raw?.pools[0]?.warnings).toContain('POOL_CLOSED_BY_SIZE_LIMIT');
  });

  it('Kyorugi cards show no movement/format line; Poomsae cards show Gerakan and Format', () => {
    expect(build({}, idOf('K-MISSING')).html).not.toContain('Gerakan');
    const html = build({}, idOf('P-RAW-KEY')).html;
    expect(html).toContain('Gerakan: Taegeuk 1');
    expect(html).toContain('Format: Individu');
    expect(build({}, idOf('P-PAIR')).html).toContain('Format: Pasangan');
  });

  it('a pair entry stacks one belt/height/weight line per athlete', () => {
    expect(build({}, idOf('P-PAIR')).html).toMatch(/Geup \d<br>Geup \d/);
  });

  it('shows the compact bracket with the persisted match codes, BYEs and the final', () => {
    const { html } = build();
    expect(html).toContain('<svg');
    expect(html).toContain('A1-R1-1');
    expect(html).toContain('A1-R2-1');
    expect(html).toContain('BYE'); // 3-participant pool
    expect(html).toContain('FINAL');
  });

  it('a walkover pool is flagged and has no bracket', () => {
    const wo = makeSemiPrestasiFixtureModel([
      { key: 'W', discipline: 'KYORUGI', poolSizes: [1], walkoverPools: [0] },
    ]);
    const { html } = buildSemiPrestasiCompactSheetHtml(wo, opts, null);
    expect(html).toContain('WALKOVER');
    expect(html).toContain('Tanpa bagan pertandingan.');
    expect(html).not.toContain('<svg');
  });

  it('a bracket too large for a card defers to the full bracket sheet instead of drawing an unreadable one', () => {
    const big = makeSemiPrestasiFixtureModel([{ key: 'B', discipline: 'KYORUGI', poolSizes: [40] }]);
    const { html } = buildSemiPrestasiCompactSheetHtml(big, opts, null);
    expect(html).not.toContain('<svg');
    expect(html).toContain('Bagan berukuran besar');
    const bracket = big.categories[0]?.pools[0]?.bracket;
    expect(bracket).toBeDefined();
    if (bracket) {
      expect(renderCompactBracketSvg(bracket, { width: 390, leafWidth: 108, nameChars: 24 })).toBeNull();
    }
  });

  it('a 16-slot bracket gets a wide card; a 4-slot one does not', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'W', discipline: 'KYORUGI', poolSizes: [16, 4] }]);
    const { html } = buildSemiPrestasiCompactSheetHtml(m, opts, null);
    expect(html.match(/class="card wide"/g)).toHaveLength(1);
    expect(html.match(/class="card"/g)).toHaveLength(1);
  });

  it('escapes participant text, so a hostile name cannot inject markup', () => {
    const base = makeSemiPrestasiFixtureModel([{ key: 'E', discipline: 'KYORUGI', poolSizes: [2] }]);
    const hostile = {
      ...base,
      categories: base.categories.map((c) => ({
        ...c,
        pools: c.pools.map((p) => ({
          ...p,
          members: p.members.map((e) => ({ ...e, displayName: '<script>alert(1)</script>' })),
        })),
      })),
    };
    const { html } = buildSemiPrestasiCompactSheetHtml(hostile, opts, null);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never contains NIK-like content (16-digit ids) or the word NIK', () => {
    const { html } = build();
    expect(html).not.toMatch(/\b\d{16}\b/);
    expect(html).not.toMatch(/\bnik\b/i);
  });

  it('is deterministic: the same model and options give byte-identical HTML', () => {
    expect(build().html).toBe(build().html);
    const again = makeSemiPrestasiFixtureModel(specs);
    expect(buildSemiPrestasiCompactSheetHtml(again, opts, null).html).toBe(build().html);
  });
});
