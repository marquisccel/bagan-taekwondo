import { describe, expect, it } from 'vitest';

import { formatOperatorCategoryTitle, SEMI_PRESTASI_COMPACT_LABEL } from '../presentation.js';
import type { ScheduleSlot } from '../schedule.js';
import { makeSemiPrestasiFixtureModel, type SemiFixtureCategory } from '../testing/semi-prestasi-fixtures.js';
import {
  documentMatchNumbers,
  presentationMatchNumbers,
  renderCompactBracketSvg,
} from './compact-bracket-svg.js';
import type { RenderOptions } from './layout.js';
import {
  buildSemiPrestasiCompactSheetHtml,
  buildSemiPrestasiSessionSheetHtml,
} from './semi-prestasi-compact.js';

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
      'PREVIEW · BUKAN UNTUK PENGGUNAAN RESMI',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('OFFICIAL mode has no PREVIEW watermark and drops the internal metadata block (structural reference: the legacy sheet)', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    expect(html).not.toContain('DOKUMEN RESMI');
    expect(html).not.toContain('Kode verifikasi');
    expect(html).not.toContain('PREVIEW');
    expect(html).not.toContain('class="watermark"');
    expect(build().html).toContain('class="watermark"');
    expect(build().html).toContain('Kode verifikasi');
  });

  it('REVISION scope headings use the canonical display name with middle dots and a human weight-class label, never the raw category key or em-dash chain', () => {
    const { html } = build();
    expect(html).toContain(
      '<div class="cat-heading">Kyorugi Semi Prestasi · Pra Cadet C Putra · Under 41 kg</div>',
    );
    expect(html).toContain(
      '<div class="cat-heading">Poomsae Semi Prestasi · Pra Cadet C Putra · Taegeuk 1</div>',
    );
    expect(html).not.toContain('K-RAW-KEY');
    expect(html).not.toContain('P-RAW-KEY');
    expect(html).not.toContain('STREAM=');
    expect(html).not.toContain('-41 kg');
  });

  it('only semi-prestasi categories appear (REVISION scope)', () => {
    const { html } = build();
    expect(html).not.toContain('-99 kg');
    expect(html.match(/<div class="cat-heading">/g)).toHaveLength(4);
  });

  it('does not repeat the category name inside individual pool cards (final polish §3) — it appears once, in the per-category heading', () => {
    const { html } = build();
    expect(html).not.toContain('class="card-cat"');
    // the category heading text appears exactly once per category, never again per pool card
    const perCategory = html.match(
      /<div class="cat-heading">Kyorugi Semi Prestasi · Pra Cadet C Putra · Under 41 kg<\/div>/g,
    );
    expect(perCategory).toHaveLength(1);
  });

  it('CATEGORY scope integrates the one category title into the main doc header instead of a separate heading, and refuses a non-semi-prestasi category', () => {
    const one = build({}, idOf('K-MISSING'));
    expect(one.html.match(/<div class="cat-heading">/g)).toBeNull();
    expect(one.html).toContain(
      '<div class="doc-category">Kyorugi Semi Prestasi · Pra Cadet C Putra · Under 30 kg</div>',
    );
    expect(one.headerTitle).toContain('Under 30 kg');
    expect(() => build({}, idOf('X-PRESTASI'))).toThrow(/not a semi-prestasi category/);
  });

  it('prints an en dash (never an em dash) for a missing belt/height/weight and flags the gap in Indonesian', () => {
    const { html } = build({}, idOf('K-MISSING'));
    expect(html.match(/<td class="num na">–<\/td>/g)).toHaveLength(4); // 2 participants x height/weight
    expect(html.match(/<td class="na"><div class="clamp2">–<\/div><\/td>/g)).toHaveLength(2); // 2 participants x belt (left-aligned, not "num")
    expect(html).toContain('Data belum lengkap: sabuk, tinggi badan, berat badan.');
    expect(html).not.toContain('—');
  });

  it('prints present values converted to cm/kg with the belt COLOR (never the raw code or rank prefix)', () => {
    const { html } = build();
    expect(html).toContain('Kuning');
    expect(html).not.toContain('Geup');
    expect(html).not.toContain('GEUP_9');
    // The unit lives in the header ("TB (cm)"/"BB (kg)") now, not repeated on every value.
    expect(html).toContain('>142</td>'); // 1420 mm -> 142 cm
    expect(html).toContain('>34</td>'); // 34000 g -> 34 kg
    expect(html).toContain('>35,5</td>');
  });

  it("uses the rule set's own curated belt label when the model carries one, showing only the color — never the raw GEUP_N code or the rank prefix", () => {
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
    expect(html).toContain('>Kuning<');
    expect(html).not.toContain('GEUP_9');
    expect(html).not.toContain('Geup 9');
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

  it("a Poomsae pool's Gerakan/Format sit inline with its own peserta/bagan count, to the right of Pool N (visual polish pass) -- never on a separate line below", () => {
    const html = build({}, idOf('P-RAW-KEY')).html;
    expect(html).toMatch(
      /<span class="card-count">4 peserta &middot; Bagan 4 slot &middot; Gerakan: Taegeuk 1 &middot; Format: Individu<\/span>/,
    );
    expect(html).not.toContain('class="card-poomsae"');
  });

  it('height/weight headers are short and carry the unit ("TB (cm)"/"BB (kg)"), values are plain numbers (visual polish pass, reverting the prior full-word-header/per-value-unit design after it was reported as too wide)', () => {
    const { html } = build();
    expect(html).toContain('>TB (cm)<');
    expect(html).toContain('>BB (kg)<');
    expect(html).not.toContain('>Tinggi Badan<');
    expect(html).not.toContain('>Berat Badan<');
    expect(html).toMatch(/<td class="num">142<\/td>/);
    expect(html).toMatch(/<td class="num">34<\/td>/);
    expect(html).not.toContain('142 cm');
    expect(html).not.toContain('34 kg');
  });

  it('a pair entry stacks one belt/height/weight line per athlete', () => {
    const html = build({}, idOf('P-PAIR')).html;
    expect(html).toMatch(/<div class="clamp2">Kuning<\/div><div class="clamp2">Kuning<\/div>/);
    expect(html).toMatch(/>142<br>142</);
  });

  it('shows the compact bracket with the persisted match codes and the final; a 3-participant pool never shows BYE (official bracket structure) -- the third participant advances straight to the final', () => {
    const { html } = build();
    expect(html).toContain('<svg');
    expect(html).toContain('A1-R1-1');
    expect(html).toContain('A1-R2-1');
    expect(html).not.toContain('BYE');
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

  it('every pool row is uniformly full width regardless of bracket size — there is no adaptive wide/compact card distinction (layout correction)', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'W', discipline: 'KYORUGI', poolSizes: [16, 4] }]);
    const { html } = buildSemiPrestasiCompactSheetHtml(m, opts, null);
    expect(html).not.toContain('wide');
    expect(html.match(/class="card"/g)).toHaveLength(2);
    // both pools' brackets are drawn from the same nominal area config (POOL_BRACKET_AREA) — the
    // 16-slot bracket's own width/height are simply larger, never stretched to fill the container
    // (that used to inflate a small bracket far more than a large one — visual polish pass)
    expect(
      html.match(/<svg width="[\d.]+" height="[\d.]+" viewBox="0 0 [\d.]+ [\d.]+" style="display:block"/g),
    ).toHaveLength(2);
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

  it('Peserta and Kontingen are independent table cells/columns, never one stacked on the other (table refinement §3)', () => {
    const { html } = build();
    expect(html).toContain('<th>Peserta</th><th>Kontingen</th>');
    expect(html).toContain('<td><div class="nm clamp2">Peserta 1A 1</div></td>');
    expect(html).toContain('<td><div class="ct clamp2">Kontingen 1</div></td>');
    // the old stacked-in-one-cell shape (name and contingent inside the same <td>) must be gone
    expect(html).not.toMatch(/<div class="nm[^"]*">[^<]*<\/div><div class="ct/);
  });

  it('a normal 1–4 participant multi-word belt color never needs 3 lines (table refinement §4) — clamped to at most 2', () => {
    const twoWord = makeSemiPrestasiFixtureModel([{ key: 'BW', discipline: 'KYORUGI', poolSizes: [2] }]);
    const labelled = {
      ...twoWord,
      categories: twoWord.categories.map((c) => ({
        ...c,
        pools: c.pools.map((p) => ({
          ...p,
          members: p.members.map((e) => ({
            ...e,
            athletes: e.athletes.map((a) => ({ ...a, beltLabel: 'Geup 8 (kuning strip hijau)' })),
          })),
        })),
      })),
    };
    const { html } = buildSemiPrestasiCompactSheetHtml(labelled, opts, null);
    expect(html).toContain('<div class="clamp2">Kuning Strip Hijau</div>');
    // the belt cell relies on the same deterministic 2-line clamp as name/contingent, never a 3rd line
    expect(html).toMatch(/table\.pt \.clamp2 \{[^}]*-webkit-line-clamp: 2;/);
  });

  it('is deterministic: the same model and options give byte-identical HTML', () => {
    expect(build().html).toBe(build().html);
    const again = makeSemiPrestasiFixtureModel(specs);
    expect(buildSemiPrestasiCompactSheetHtml(again, opts, null).html).toBe(build().html);
  });
});

/**
 * OFFICIAL PDF privacy (PDF Presentation Remediation, official participant row): belt/height/weight
 * are drawing inputs, not opponent-facing information, and must never appear in the document
 * distributed outside the drawing committee. PREVIEW is unaffected -- panitia still needs those
 * fields to review grouping quality before publishing.
 */
describe('OFFICIAL vs PREVIEW field visibility (official privacy)', () => {
  it('FINAL/OFFICIAL contains no Sabuk column or values', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    // `>Sabuk<` (an actual rendered header/cell), not a substring match against the shared
    // stylesheet's own source comments (e.g. "Peserta/Kontingen/Sabuk are visually clamped...").
    expect(html).not.toContain(`>${SEMI_PRESTASI_COMPACT_LABEL.belt}<`);
    expect(html).not.toContain('>Kuning<');
    expect(html).not.toContain('>Hijau<');
  });

  it('FINAL/OFFICIAL contains no TB (height) column or values', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    expect(html).not.toContain('TB (cm)');
    expect(html).not.toContain('Tinggi Badan');
    expect(html).not.toMatch(/<td class="num">142<\/td>/);
  });

  it('FINAL/OFFICIAL contains no BB (weight) column or values', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    expect(html).not.toContain('BB (kg)');
    expect(html).not.toContain('Berat Badan');
    expect(html).not.toMatch(/<td class="num">34<\/td>/);
  });

  it('FINAL/OFFICIAL never exposes a participant/entry UUID or other internal identifier', () => {
    const { html } = build({ mode: 'OFFICIAL' });
    // the fixture's entry ids are plain strings like "c1-p1-e0" -- confirm none of that id shape leaks
    for (const c of model.categories) {
      for (const p of c.pools) {
        for (const e of p.members) {
          expect(html).not.toContain(e.id);
        }
      }
    }
    expect(html).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });

  it('PREVIEW still contains Sabuk/TB/BB for panitia review', () => {
    const { html } = build({ mode: 'PREVIEW' });
    expect(html).toContain(SEMI_PRESTASI_COMPACT_LABEL.belt);
    expect(html).toContain('TB (cm)');
    expect(html).toContain('BB (kg)');
    expect(html).toContain('Kuning');
  });

  it('OFFICIAL never flags a belt/height/weight gap in the footer -- those columns are not shown at all', () => {
    const { html } = build({ mode: 'OFFICIAL' }, idOf('K-MISSING'));
    expect(html).not.toContain('Data belum lengkap');
  });
});

describe('3-participant bracket structure (official bracket structure, PDF Presentation Remediation)', () => {
  it('never displays BYE merely as graphical padding, and never invents a fourth participant', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'T3', discipline: 'KYORUGI', poolSizes: [3] }]);
    const { html } = buildSemiPrestasiCompactSheetHtml(m, opts, null);
    expect(html).not.toContain('BYE');
    // exactly 3 participant rows, not 4
    expect(html.match(/<td class="nm clamp2">|<div class="nm clamp2">/g)?.length ?? 0).toBe(3);
  });

  it('the third participant advances directly into the final match, never through a drawn first-round box', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'T3', discipline: 'KYORUGI', poolSizes: [3] }]);
    const category = m.categories[0]!;
    const pool = category.pools[0]!;
    const bracket = pool.bracket!;
    const walkover = bracket.matches.find((mm) => mm.status === 'WALKOVER');
    const real = bracket.matches.filter((mm) => mm.status !== 'WALKOVER');
    expect(walkover).toBeDefined();
    // exactly 2 real matches for 3 entries (INV-04: n-1 real matches), one first round, one final
    expect(real).toHaveLength(2);
    expect(real.some((mm) => mm.round === 1)).toBe(true);
    expect(real.some((mm) => mm.round === bracket.rounds)).toBe(true);
  });

  it('a 2-participant pool has no fake empty slot', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'T2', discipline: 'KYORUGI', poolSizes: [2] }]);
    const { html } = buildSemiPrestasiCompactSheetHtml(m, opts, null);
    expect(html).not.toContain('BYE');
    expect(html.match(/<div class="nm clamp2">/g)).toHaveLength(2);
  });

  it('a 4-participant pool remains two semifinals + a final (unaffected by the walkover fix — no byes at n=4)', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'T4', discipline: 'KYORUGI', poolSizes: [4] }]);
    const category = m.categories[0]!;
    const bracket = category.pools[0]!.bracket!;
    expect(bracket.matches.every((mm) => mm.status !== 'WALKOVER')).toBe(true);
    expect(bracket.matches.filter((mm) => mm.round === 1)).toHaveLength(2);
    expect(bracket.matches.filter((mm) => mm.round === 2)).toHaveLength(1);
    const { html } = buildSemiPrestasiCompactSheetHtml(m, opts, null);
    expect(html).not.toContain('BYE');
  });
});

/**
 * FINAL/OFFICIAL bracket presentation: the bracket is the participant list. No side table, name +
 * contingent on each leaf, plain sequential match numbers instead of internal codes, no "Bagan N slot".
 */
describe('FINAL/OFFICIAL full-width bracket presentation', () => {
  const official = (key: string) => build({ mode: 'OFFICIAL' }, idOf(key)).html;
  const texts = (html: string): string[] =>
    [...html.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1] as string);
  const visible = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/, '');
  const single = (size: number) => {
    const m = makeSemiPrestasiFixtureModel([{ key: `S${size}`, discipline: 'KYORUGI', poolSizes: [size] }]);
    return {
      m,
      html: buildSemiPrestasiCompactSheetHtml(m, { ...opts, mode: 'OFFICIAL' }, null).html,
    };
  };

  it('has no separate participant table', () => {
    const html = visible(official('K-MISSING'));
    expect(html).not.toContain('<table class="pt"');
    expect(html).not.toContain('col-table');
    expect(html).not.toContain('<th');
  });

  it('shows each participant exactly once, with name and contingent inside the bracket leaf', () => {
    for (const size of [2, 3, 4]) {
      const { m, html } = single(size);
      const members = m.categories[0]!.pools[0]!.members;
      const t = texts(html);
      expect(members).toHaveLength(size);
      for (const e of members) {
        expect(t.filter((x) => x === e.displayName)).toHaveLength(1);
        expect(t.filter((x) => x === e.contingent)).toHaveLength(1);
        expect(html.split(e.displayName).length - 1).toBe(1);
      }
    }
  });

  it('hides Sabuk/TB/BB and the "Bagan N slot"/"Pool N"/peserta-count wording entirely', () => {
    const html = visible(single(4).html);
    expect(html).not.toMatch(/Bagan \d+ slot/);
    expect(html).not.toContain('slot');
    expect(html).not.toContain('Sabuk');
    expect(html).not.toContain('TB (cm)');
    expect(html).not.toContain('BB (kg)');
    expect(html).not.toContain('pool-no');
    expect(html).not.toContain('card-count');
  });

  it('labels matches with sequential integers and never prints an internal match code', () => {
    for (const size of [2, 3, 4]) {
      const { m, html } = single(size);
      expect(html).not.toMatch(/[A-Z]\d+-R\d+-\d+/);
      const bracket = m.categories[0]!.pools[0]!.bracket!;
      for (const mm of bracket.matches) if (mm.publicCode) expect(html).not.toContain(mm.publicCode);
      const drawn = bracket.matches.filter((mm) => mm.status !== 'WALKOVER').length;
      const numbers = texts(html).filter((x) => /^\d+$/.test(x));
      expect(numbers).toEqual(Array.from({ length: drawn }, (_, i) => String(i + 1)).sort());
    }
  });

  it('numbers in competition order (round, then position) and leaves persisted codes/uids untouched', () => {
    const { m } = single(4);
    const bracket = m.categories[0]!.pools[0]!.bracket!;
    const before = JSON.stringify(bracket.matches.map((x) => [x.matchUid, x.publicCode]));
    const nodes = bracket.matches.map((x) => ({ match: x }));
    const numbers = presentationMatchNumbers(nodes);
    const ordered = [...bracket.matches].sort((a, b) => a.round - b.round || a.position - b.position);
    ordered.forEach((x, i) => {
      expect(numbers.get(x.matchUid)).toBe(i + 1);
    });
    expect(numbers.get(ordered[ordered.length - 1]!.matchUid)).toBe(bracket.matches.length);
    expect(JSON.stringify(bracket.matches.map((x) => [x.matchUid, x.publicCode]))).toBe(before);
    const reversed = presentationMatchNumbers([...nodes].reverse());
    expect([...reversed.entries()].sort()).toEqual([...numbers.entries()].sort());
  });

  it('3 participants: exactly 3 leaves, no BYE, no fourth slot; 2 and 4 keep their leaves', () => {
    for (const size of [2, 3, 4]) {
      const { html } = single(size);
      expect(html).not.toContain('BYE');
      // one leaf line per participant
      expect(html.match(/<line x1="0" /g)).toHaveLength(size);
    }
  });

  it('draws every bracket line with one uniform weight and colour (no thin-to-thick break between rounds)', () => {
    const { html } = single(4);
    const strokes = new Set(
      [...visible(html).matchAll(/stroke="(#[0-9a-f]+)" stroke-width="([\d.]+)"/gi)].map(
        (m) => `${m[1]}/${m[2]}`,
      ),
    );
    expect([...strokes]).toEqual(['#222/1.1']);
  });

  it('renders no card-head row at all for a pool (structural reference: whitespace-only separation)', () => {
    const html = visible(single(4).html);
    expect(html).not.toContain('card-head');
    expect(html).not.toContain('class="row"');
  });

  it('a long name and contingent are wrapped/clipped inside the leaf, never overflowing the sheet', () => {
    const m = makeSemiPrestasiFixtureModel([{ key: 'L', discipline: 'KYORUGI', poolSizes: [4] }]);
    const pool = m.categories[0]!.pools[0]!;
    const longName = 'Muhammad Abdurrahman Al-Fatihunnashiruddin bin Ibrahim Kusumawardhana Santoso';
    const longContingent =
      'Perguruan Taekwondo Sangat Panjang Sekali Kabupaten Kota Provinsi Nusantara Raya Indonesia Bersatu';
    const member = pool.members[0]!;
    (member as { displayName: string }).displayName = longName;
    (member as { contingent: string | null }).contingent = longContingent;
    const { html } = buildSemiPrestasiCompactSheetHtml(m, { ...opts, mode: 'OFFICIAL' }, null);
    const t = texts(html);
    expect(t.some((x) => x.endsWith('…') || longName.startsWith(x))).toBe(true);
    for (const x of t) expect(x.length).toBeLessThanOrEqual(78);
    expect(html).toContain('viewBox="0 0 1400');
  });

  it('a lone walkover participant is still listed once (no table to carry them)', () => {
    const wo = makeSemiPrestasiFixtureModel([
      { key: 'W', discipline: 'KYORUGI', poolSizes: [1], walkoverPools: [0] },
    ]);
    const { html } = buildSemiPrestasiCompactSheetHtml(wo, { ...opts, mode: 'OFFICIAL' }, null);
    const name = wo.categories[0]!.pools[0]!.members[0]!.displayName;
    expect(html.split(name).length - 1).toBe(1);
  });

  it('PREVIEW keeps the table, belt/TB/BB, "Bagan N slot" and the internal match codes', () => {
    const html = build({ mode: 'PREVIEW' }).html;
    expect(html).toContain('<table class="pt"');
    expect(html).toContain('Bagan 4 slot');
    expect(html).toContain('A1-R1-1');
  });

  it('rendering is deterministic', () => {
    expect(official('K-MISSING')).toBe(official('K-MISSING'));
    expect(build({ mode: 'OFFICIAL' }).html).toBe(build({ mode: 'OFFICIAL' }).html);
  });
});

describe('FINAL/OFFICIAL document-sequential match numbering', () => {
  const multi = makeSemiPrestasiFixtureModel([
    { key: 'A', discipline: 'KYORUGI', poolSizes: [4, 3, 2], weightClassCode: '-30' },
    { key: 'B', discipline: 'KYORUGI', poolSizes: [3, 4], weightClassCode: '-40' },
  ]);
  const officialHtml = (): string =>
    buildSemiPrestasiCompactSheetHtml(multi, { ...opts, mode: 'OFFICIAL' }, null).html;
  /** Match-number labels, in document order, per pool card. */
  const perPool = (html: string): number[][] =>
    html
      .split(/<div class="card(?: official| tall)*">/)
      .slice(1)
      .map((card) => [...card.matchAll(/font-weight="700">(\d+)<\/text>/g)].map((m) => Number(m[1])));

  it('never restarts between pools: one contiguous sequence with no duplicates', () => {
    const pools = perPool(officialHtml());
    expect(pools).toHaveLength(5);
    const all = pools.flat();
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
    expect(new Set(all).size).toBe(all.length);
    // 4-person: 3 matches, 3-person: 2, 2-person: 1, 3-person: 2, 4-person: 3
    expect(pools.map((p) => p.length)).toEqual([3, 2, 1, 2, 3]);
    expect(pools.map((p) => p[0])).toEqual([1, 4, 6, 7, 9]);
  });

  it('within a pool, earlier-round matches are numbered before later-round ones (the final is last)', () => {
    const pools = perPool(officialHtml());
    for (const p of pools) expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(pools[0]).toEqual([1, 2, 3]);
  });

  it('a collapsed WALKOVER match receives no number, and internal codes/uids stay untouched', () => {
    const bracket = multi.categories[0]!.pools[1]!.bracket!;
    const before = JSON.stringify(bracket.matches);
    const walkover = bracket.matches.find((m) => m.status === 'WALKOVER')!;
    const numbers = documentMatchNumbers(multi.categories.flatMap((c) => c.pools.map((p) => p.bracket)));
    expect(numbers.has(walkover.matchUid)).toBe(false);
    expect(JSON.stringify(bracket.matches)).toBe(before);
    for (const m of bracket.matches) {
      if (m.publicCode) expect(officialHtml()).not.toContain(m.publicCode);
    }
    expect(officialHtml()).not.toMatch(/[A-Z]\d+-R\d+-\d+/);
    expect(new Set(numbers.values()).size).toBe(numbers.size);
  });

  it('is deterministic: the same source yields the same numbering every time', () => {
    expect(officialHtml()).toBe(officialHtml());
    const brackets = multi.categories.flatMap((c) => c.pools.map((p) => p.bracket));
    expect([...documentMatchNumbers(brackets)]).toEqual([...documentMatchNumbers(brackets)]);
  });

  it('PREVIEW keeps the internal stable match codes (no display renumbering)', () => {
    const html = buildSemiPrestasiCompactSheetHtml(multi, { ...opts, mode: 'PREVIEW' }, null).html;
    expect(html).toMatch(/[A-Z]\d+-R\d+-\d+/);
  });
});

describe('3-participant bracket geometry is the same in PREVIEW and FINAL', () => {
  for (const mode of ['PREVIEW', 'OFFICIAL'] as const) {
    it(`${mode}: participant 3's line reaches the final, no BYE, no fourth participant`, () => {
      const m = makeSemiPrestasiFixtureModel([{ key: 'T3', discipline: 'KYORUGI', poolSizes: [3] }]);
      const { html } = buildSemiPrestasiCompactSheetHtml(m, { ...opts, mode }, null);
      expect(html).not.toContain('BYE');
      const leafLines = [...html.matchAll(/<line x1="0" y1="([\d.]+)" x2="([\d.]+)"/g)];
      expect(leafLines).toHaveLength(3);
      const [, y3, leafEnd] = leafLines[2] as unknown as [string, string, string];
      const stub = [...html.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].find(
        (l) => l[1] === leafEnd && l[2] === y3,
      );
      expect(stub).toBeDefined();
      expect(Number(stub![3])).toBeGreaterThan(Number(leafEnd));
    });
  }
});

describe('FINAL/OFFICIAL: structural reference to the legacy manually-produced bracket sheet', () => {
  it('drops the discipline/kesiapan wording from the category info line -- "N peserta · M pool" only', () => {
    const html = build({ mode: 'OFFICIAL' }).html;
    expect(html).toMatch(/<div class="cat-info">7 peserta &middot; 2 pool<\/div>/);
    expect(html).not.toContain('Kesiapan');
    const preview = build({ mode: 'PREVIEW' }).html;
    expect(preview).toContain('Kesiapan');
    expect(preview).toContain('Kyorugi &middot;');
  });

  it('shows id/gender/division/weight-class alongside name and contingent on each leaf', () => {
    const html = build({ mode: 'OFFICIAL' }, idOf('K-MISSING')).html;
    expect(html).toContain('>EXT-');
    expect(html).toContain('>Laki-laki<');
    expect(html).toContain('>PRA CADET C<');
    expect(html).toContain('>-30<');
  });

  it("leaves a Poomsae leaf's weight-class column blank rather than guessing (Poomsae has none)", () => {
    const html = build({ mode: 'OFFICIAL' }, idOf('P-RAW-KEY')).html;
    expect(html).toContain('>Laki-laki<');
    expect(html).not.toContain('>-99<');
  });

  it('separates pools by whitespace only -- no border, no rule line, no "Pool N"/peserta-count heading', () => {
    const stripStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '');
    const html = stripStyle(build({ mode: 'OFFICIAL' }, idOf('K-MISSING')).html);
    expect(html).toMatch(/<div class="card official">/);
    expect(html).not.toContain('card-head');
    expect(html).not.toContain('>Pool ');
    expect(html).not.toMatch(/card-count/);
    const preview = stripStyle(build({ mode: 'PREVIEW' }, idOf('K-MISSING')).html);
    expect(preview).toMatch(/<div class="card">/);
    expect(preview).not.toContain('card official');
    expect(preview).toContain('>Pool 1<');
  });

  it('never prints the word "FINAL" next to a match number (pure numbers only)', () => {
    const html = build({ mode: 'OFFICIAL' }).html;
    expect(html).not.toContain('>FINAL<');
    const preview = build({ mode: 'PREVIEW' }).html;
    expect(preview).toContain('>FINAL<');
  });
});

describe('FINAL/OFFICIAL arena/day SESSION document (buildSemiPrestasiSessionSheetHtml)', () => {
  const kyorugi = makeSemiPrestasiFixtureModel([
    { key: 'S-K1', discipline: 'KYORUGI', poolSizes: [4, 3], weightClassCode: '-45' },
    { key: 'S-K2', discipline: 'KYORUGI', poolSizes: [3], weightClassCode: '-48' },
  ]);
  const poomsae = makeSemiPrestasiFixtureModel([{ key: 'S-P1', discipline: 'POOMSAE', poolSizes: [4] }]);
  const categoryOf = (m: typeof kyorugi, key: string) => m.categories.find((c) => c.categoryKey === key)!;
  const slotFor = (m: typeof kyorugi, keys: readonly string[]): ScheduleSlot => ({
    dayNumber: 1,
    dayLabel: 'Jumat, 18 September 2026',
    arena: 'ARENA A',
    categories: keys.map((k) => {
      const c = categoryOf(m, k);
      return {
        discipline: c.discipline,
        gender: c.gender,
        ageDivisionCode: c.ageDivisionCode,
        weightClassCode: c.weightClassCode,
      };
    }),
  });

  it('titles the document "DAY N · ARENA X · <classification>" with the weekday/date underneath', () => {
    const slot = slotFor(kyorugi, ['S-K1', 'S-K2']);
    const { html } = buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'OFFICIAL' }, slot);
    expect(html).toContain('<h1>DAY 1 &middot; ARENA A &middot; Kyorugi Semi Prestasi</h1>');
    expect(html).toContain('<div class="doc-category">Jumat, 18 September 2026</div>');
    expect(html).not.toContain('DOKUMEN RESMI');
  });

  it('never shows a per-category heading/info line in OFFICIAL -- only the leaf columns tell categories apart; PREVIEW keeps it', () => {
    const slot = slotFor(kyorugi, ['S-K1', 'S-K2']);
    const stripStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '');
    const official = stripStyle(
      buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'OFFICIAL' }, slot).html,
    );
    expect(official).not.toContain(formatOperatorCategoryTitle(categoryOf(kyorugi, 'S-K1')));
    expect(official).not.toContain('cat-heading');
    expect(official).not.toContain('cat-info');
    const preview = buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'PREVIEW' }, slot).html;
    expect(preview).toContain(formatOperatorCategoryTitle(categoryOf(kyorugi, 'S-K1')));
  });

  it("includes every category the schedule places in the slot, in the schedule's own order -- Kyorugi and Poomsae alike", () => {
    const mixed = makeSemiPrestasiFixtureModel([
      { key: 'S-K1', discipline: 'KYORUGI', poolSizes: [4, 3], weightClassCode: '-45' },
      { key: 'S-P1', discipline: 'POOMSAE', poolSizes: [4] },
    ]);
    const slot = slotFor(mixed, ['S-P1', 'S-K1']);
    const { html } = buildSemiPrestasiSessionSheetHtml(mixed, { ...opts, mode: 'OFFICIAL' }, slot);
    const kName = categoryOf(mixed, 'S-K1').pools[0]!.members[0]!.displayName;
    const pName = categoryOf(mixed, 'S-P1').pools[0]!.members[0]!.displayName;
    expect(html).toContain(kName);
    expect(html).toContain(pName);
    expect(html.indexOf(pName)).toBeLessThan(html.indexOf(kName));
  });

  it('numbers matches sequentially across the WHOLE arena/day document, not restarting per category', () => {
    const slot = slotFor(kyorugi, ['S-K1', 'S-K2']);
    const { html } = buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'OFFICIAL' }, slot);
    const numbers = [...html.matchAll(/font-weight="700">(\d+)<\/text>/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it('skips a schedule row with no matching category, and throws when the slot matches nothing at all', () => {
    const slot: ScheduleSlot = {
      dayNumber: 1,
      dayLabel: 'Jumat, 18 September 2026',
      arena: 'ARENA A',
      categories: [
        { discipline: 'KYORUGI', gender: 'MALE', ageDivisionCode: 'NOT_SCHEDULED', weightClassCode: '-99' },
        ...slotFor(kyorugi, ['S-K1']).categories,
      ],
    };
    const { html } = buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'OFFICIAL' }, slot);
    expect(html).toContain(categoryOf(kyorugi, 'S-K1').pools[0]!.members[0]!.displayName);
    expect(() =>
      buildSemiPrestasiSessionSheetHtml(poomsae, { ...opts, mode: 'OFFICIAL' }, slotFor(kyorugi, ['S-K1'])),
    ).toThrow();
  });

  it('PREVIEW keeps the full metadata block for a session document too', () => {
    const slot = slotFor(kyorugi, ['S-K1']);
    const html = buildSemiPrestasiSessionSheetHtml(kyorugi, { ...opts, mode: 'PREVIEW' }, slot).html;
    expect(html).toContain('Kode verifikasi');
  });
});
