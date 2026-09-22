import type { ExportAthleteDisplay, ExportCategory, ExportEntry, ExportModel, ExportPool } from '../model.js';
import {
  beltDisplay,
  disciplineLabel,
  formatCategoryDisplayName,
  formatHeightCm,
  formatLabel,
  formatWeightKg,
  humanizeCode,
  MISSING_VALUE,
  participantCountLabel,
  poolLabel,
  qualitySummaryLabel,
  readinessLabel,
  revisionLifecycleLabel,
  SEMI_PRESTASI_COMPACT_LABEL as L,
} from '../presentation.js';
import { selectSemiPrestasiCategories } from '../semi-prestasi.js';
import { compactBracketFits, renderCompactBracketSvg } from './compact-bracket-svg.js';
import {
  esc,
  footerTemplate,
  headerTemplate,
  modeLabel,
  PDF_BASE_CSS,
  watermarkHtml,
  type RenderOptions,
} from './layout.js';
import { renderHtmlToPdf } from './render.js';

/**
 * AUD-012 — the compact semi-prestasi tournament-desk sheet, the PRIMARY operational document for
 * semi-prestasi. A dense, print-first document for the drawing committee, complaint review and the
 * tournament desk: one card per pool (participants with belt/height/weight/contingent + a small
 * bracket with printed match codes). Rendering only — every value is read from the canonical
 * `ExportModel` exactly as Phase 3/4 persisted it; nothing here draws, seeds, pools or re-checks
 * quality, and a value that is not persisted prints as "—", never a guess. There is no NIK anywhere
 * in the model, hence none here. Detailed engine reason codes belong in the audit-oriented
 * `CATEGORY_DRAW` document (category-draw.ts), never here — this sheet only ever shows a plain
 * "data belum lengkap" gap note, never a POOL_* code (PDF Presentation Remediation).
 *
 * Landscape, 2 columns: since semi-prestasi pools are almost always 1–4 participants, EVERY card
 * (not only the large-bracket "wide" ones) places its table and bracket side by side rather than
 * stacked — that is what makes a card only as tall as its roster, so a 2×4 grid (~8 pools/page) is
 * reachable without shrinking text; a category with longer rosters/names simply fits fewer per page.
 */

/** Bracket drawing area (CSS px, ~ the card's inner width) for a normal (2-column) card vs a wide (full-width) card. */
const HALF_CARD_BRACKET = { width: 270, leafWidth: 66, nameChars: 15 } as const;
const WIDE_CARD_BRACKET = { width: 560, leafWidth: 108, nameChars: 26 } as const;

/**
 * A pool whose table is roughly a page tall (>= ~30 participants) may fragment across pages; keeping it in
 * one piece would push it to a fresh page and leave the category heading stranded on a blank one.
 */
const TALL_CARD_MIN_LINES = 60;

/** Brackets with more than 8 slots (i.e. > 4 first-round matches) get a full-width card. */
const WIDE_CARD_MIN_SIZE = 9;

const COMPACT_CSS = `
  body { font-size: 7.5pt; line-height: 1.25; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm;
    border-bottom: 0.8pt solid #111; padding-bottom: 1.5mm; margin-bottom: 2.5mm; }
  .doc-head h1 { font-size: 13pt; margin: 0; }
  .doc-head .doc-kicker { margin-bottom: 0.5mm; }
  .doc-sub { font-size: 7pt; color: #444; }
  .doc-meta { font-size: 7pt; color: #333; text-align: right; line-height: 1.35; }
  .doc-mode { font-weight: 700; }
  .quality-line { font-size: 7pt; color: #7a4b00; margin: 0 0 2mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; margin-bottom: 4mm; }
  .cat-head { grid-column: 1 / -1; break-after: avoid; page-break-after: avoid;
    border-left: 2.2pt solid #111; background: #ececec; padding: 1mm 2mm; }
  .cat-head h2 { font-size: 9.5pt; margin: 0; page-break-after: avoid; }
  .cat-info { font-size: 7pt; color: #333; margin-top: 0.3mm; }
  .card { border: 0.5pt solid #555; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
  .card.wide { grid-column: 1 / -1; }
  .card.tall { break-inside: auto; page-break-inside: auto; }
  .card-head { background: #f3f3f3; border-bottom: 0.5pt solid #555; padding: 0.7mm 1.5mm; }
  .card-head .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
  .pool-no { font-size: 9pt; font-weight: 700; }
  .pool-flag { font-size: 6.5pt; font-weight: 700; color: #a33; margin-left: 1.5mm; }
  .card-count { font-size: 6.5pt; color: #333; white-space: nowrap; }
  .card-poomsae { font-size: 6.5pt; color: #222; }
  .card-body { padding: 0; display: flex; gap: 2mm; align-items: flex-start; }
  .card-body .col-table { width: 44%; flex: none; min-width: 0; }
  .card-body .col-bracket { flex: 1; min-width: 0; }
  .card.wide .card-body .col-table { width: 46%; }
  table.pt { margin: 0; width: 100%; table-layout: fixed; }
  table.pt th, table.pt td { font-size: 7pt; padding: 0.3mm 1mm; border: 0.3pt solid #bbb; line-height: 1.15; }
  table.pt th { font-size: 6.2pt; background: #e8e8e8; padding: 0.3mm 0.4mm; white-space: nowrap; }
  table.pt tr { break-inside: avoid; page-break-inside: avoid; }
  table.pt td.num, table.pt th.num { text-align: center; }
  /* Name/contingent are visually clamped to 2 lines (with an ellipsis) so one very long entry never
     stretches a whole pool card — the full text still round-trips through this same HTML, unclamped,
     to POOL_SHEET/XLSX/the DOM itself; only how this document paints it is bounded (final polish §2). */
  table.pt .nm, table.pt .ct { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; overflow: hidden; }
  table.pt .nm { font-weight: 600; }
  table.pt .ct { font-size: 6.2pt; color: #333; font-weight: 400; }
  table.pt .na { color: #666; }
  .col-bracket, .bk { padding: 0.5mm 1.2mm 0.3mm; }
  .bk-note { font-size: 6.5pt; color: #555; font-style: italic; padding: 0.8mm 1.5mm; }
  .card-foot { border-top: 0.3pt solid #bbb; padding: 0.5mm 1.5mm; font-size: 6.3pt; color: #7a4b00; line-height: 1.25; }
  .card-foot .code-tag { font-size: 5.5pt; color: #8a7a60; }
  .card-foot .gap { color: #555; }
`;

const NUMBER_COL = '5.5mm';

interface BracketArea {
  readonly width: number;
  readonly leafWidth: number;
  readonly nameChars: number;
}

/** Slot number a participant sits on within the pool's bracket (the same "Posisi" the pool sheet prints), else 1-based order. */
function positionOf(pool: ExportPool, entry: ExportEntry, index: number): number {
  const slot = pool.bracket?.slots.find((s) => s.entry?.id === entry.id);
  return slot ? slot.position + 1 : index + 1;
}

/** One value per athlete of the entry ("—" for each absent one); a pair/team entry stacks one line per athlete. */
function perAthlete(e: ExportEntry, pick: (a: ExportEntry['athletes'][number]) => string): string[] {
  return e.athletes.length === 0 ? [MISSING_VALUE] : e.athletes.map(pick);
}

function valueCell(values: readonly string[]): string {
  const absent = values.every((v) => v === MISSING_VALUE);
  return `<td class="num${absent ? ' na' : ''}">${values.map(esc).join('<br>')}</td>`;
}

function participantRow(pool: ExportPool, e: ExportEntry, index: number): string {
  return `<tr>
    <td class="num">${positionOf(pool, e, index)}</td>
    <td><div class="nm">${esc(e.displayName)}</div><div class="ct">${e.contingent ? esc(e.contingent) : MISSING_VALUE}</div></td>
    ${valueCell(perAthlete(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}${valueCell(perAthlete(e, (a) => formatHeightCm(a.heightMm)))}${valueCell(perAthlete(e, (a) => formatWeightKg(a.weightG)))}
  </tr>`;
}

function participantTable(pool: ExportPool): string {
  const rows = pool.members.map((e, i) => participantRow(pool, e, i)).join('');
  return `<table class="pt">
    <colgroup><col style="width:${NUMBER_COL}"><col><col style="width:12mm"><col style="width:11mm"><col style="width:11mm"></colgroup>
    <thead><tr><th class="num">${esc(L.number)}</th><th>${esc(L.participant)}</th><th class="num">${esc(L.belt)}</th><th class="num">${esc(L.heightCm)}</th><th class="num">${esc(L.weightKg)}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">${esc(L.noParticipants)}</td></tr>`}</tbody>
  </table>`;
}

function bracketHtml(pool: ExportPool, area: BracketArea): string {
  const bracket = pool.bracket;
  if (!bracket || bracket.matches.length === 0) return `<div class="bk-note">${esc(L.noBracket)}</div>`;
  if (!compactBracketFits(bracket)) return `<div class="bk-note">${esc(L.bracketTooLarge)}</div>`;
  const svg = renderCompactBracketSvg(bracket, area);
  return svg ? `<div class="bk">${svg}</div>` : `<div class="bk-note">${esc(L.noBracket)}</div>`;
}

/** Which of the printed values are absent for at least one participant — a plain "what is not on file" note. */
function missingFields(pool: ExportPool): string[] {
  const athletes = pool.members.flatMap((e): (ExportAthleteDisplay | null)[] =>
    e.athletes.length > 0 ? [...e.athletes] : [null],
  );
  const out: string[] = [];
  if (athletes.some((a) => a === null || !a.beltCode)) out.push('sabuk');
  if (athletes.some((a) => a === null || a.heightMm === null)) out.push('tinggi badan');
  if (athletes.some((a) => a === null || a.weightG === null)) out.push('berat badan');
  return out;
}

/**
 * Operational footer: a plain "data not on file" note only — never an engine reason code
 * (POOL_SIZE_PREFERENCE, POOL_RANGE, POOL_CONTINGENT_MIX, ...). Those explanations are not deleted;
 * they remain exactly as persisted in `pool.warnings` and are shown, in full, by the audit-oriented
 * `CATEGORY_DRAW` document (category-draw.ts) instead.
 */
function cardFooter(pool: ExportPool): string {
  const gaps = missingFields(pool);
  return gaps.length > 0
    ? `<div class="card-foot"><span class="gap">${esc(L.incompleteData)}: ${esc(gaps.join(', '))}.</span></div>`
    : '';
}

function poolCard(category: ExportCategory, pool: ExportPool): string {
  const isPoomsae = category.discipline === 'POOMSAE';
  const wide = (pool.bracket?.size ?? 0) >= WIDE_CARD_MIN_SIZE;
  const tableLines = pool.members.reduce((n, e) => n + Math.max(2, e.athletes.length), 0);
  const tall = tableLines > TALL_CARD_MIN_LINES;
  const area = wide ? WIDE_CARD_BRACKET : HALF_CARD_BRACKET;
  const bracketBits = pool.bracket
    ? ` &middot; Bagan ${pool.bracket.size} slot${pool.bracket.byes > 0 ? ` &middot; ${pool.bracket.byes} ${L.bye}` : ''}`
    : '';
  const poomsaeLine = isPoomsae
    ? `<div class="card-poomsae">${esc(L.movement)}: ${esc(category.movement ? humanizeCode(category.movement) : MISSING_VALUE)} &middot; ${esc(L.format)}: ${esc(formatLabel(category.format))}</div>`
    : '';
  // Always side by side (never table-then-bracket stacked): that is what keeps a card as short as
  // its roster, so the landscape 2-column grid can fit several pool cards per page.
  const body = `<div class="card-body"><div class="col-table">${participantTable(pool)}</div><div class="col-bracket">${bracketHtml(pool, area)}</div></div>`;
  return `<div class="card${wide ? ' wide' : ''}${tall ? ' tall' : ''}">
    <div class="card-head">
      <div class="row"><span><span class="pool-no">${esc(poolLabel(pool.ordinal))}</span>${pool.isWalkover ? `<span class="pool-flag">${esc(L.walkover.toUpperCase())}</span>` : ''}</span><span class="card-count">${esc(participantCountLabel(pool.members.length))}${bracketBits}</span></div>
      ${poomsaeLine}
    </div>
    ${body}
    ${cardFooter(pool)}
  </div>`;
}

function categoryInfoLine(c: ExportCategory): string {
  const bits = [
    esc(disciplineLabel(c.discipline)),
    esc(participantCountLabel(c.participantCount)),
    `${c.pools.length} pool`,
  ];
  if (c.discipline === 'POOMSAE') {
    bits.push(`${esc(L.movement)}: ${esc(c.movement ? humanizeCode(c.movement) : MISSING_VALUE)}`);
    bits.push(`${esc(L.format)}: ${esc(formatLabel(c.format))}`);
  }
  bits.push(`Kesiapan: ${esc(readinessLabel(c.readiness))}`);
  return bits.join(' &middot; ');
}

function categorySection(c: ExportCategory): string {
  const cards = c.pools.map((p) => poolCard(c, p)).join('');
  return `<div class="grid">
    <div class="cat-head"><h2>${esc(formatCategoryDisplayName(c))}</h2><div class="cat-info">${categoryInfoLine(c)}</div></div>
    ${cards || `<div class="bk-note" style="grid-column:1/-1">${esc(L.noPools)}</div>`}
  </div>`;
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(d);
};

function docHeader(model: ExportModel, opts: RenderOptions): string {
  return `<div class="doc-head">
    <div>
      <div class="doc-kicker">${esc(model.tournament.name)} (${esc(model.tournament.code)})</div>
      <h1>${esc(L.documentTitle)}</h1>
      <div class="doc-sub">${esc(L.documentSubtitle)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-mode">${esc(modeLabel(opts.mode))}</div>
      <div>Revisi ${model.revision.revisionNo} &middot; Status: ${esc(revisionLifecycleLabel(model.revision.lifecycle))}</div>
      <div>Dibuat: ${esc(fmtDate(opts.generatedAt))}</div>
      <div>Kode verifikasi: ${esc(opts.verificationCode)}</div>
    </div>
  </div>`;
}

export interface SemiPrestasiCompactSheetHtml {
  readonly title: string;
  readonly html: string;
  /** Text for the (fixed, document-wide) Chromium page header. */
  readonly headerTitle: string;
}

/**
 * The full HTML of the sheet. `categoryId === null` covers every semi-prestasi category of the
 * model (REVISION scope); a category id covers just that one, and throws if it is not semi-prestasi.
 */
export function buildSemiPrestasiCompactSheetHtml(
  model: ExportModel,
  opts: RenderOptions,
  categoryId: string | null = null,
): SemiPrestasiCompactSheetHtml {
  const categories = selectSemiPrestasiCategories(model, categoryId);
  const single = categories.length === 1 && categoryId !== null ? categories[0] : undefined;
  const qualitySummary = categoryId === null ? qualitySummaryLabel(model.quality) : null;
  const qualityLine = qualitySummary ? `<div class="quality-line">${esc(qualitySummary)}</div>` : '';
  const title = single
    ? `${L.documentTitle} — ${formatCategoryDisplayName(single)}`
    : `${L.documentTitle} — ${model.tournament.name}`;
  const body = `${docHeader(model, opts)}${qualityLine}${categories.map(categorySection).join('')}`;
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PDF_BASE_CSS}${COMPACT_CSS}</style>
</head>
<body>
${watermarkHtml(opts.mode)}
${body}
</body>
</html>`;
  return {
    title,
    html,
    headerTitle: single
      ? `${model.tournament.name} — ${L.documentTitle} — ${formatCategoryDisplayName(single)}`
      : `${model.tournament.name} — ${L.documentTitle}`,
  };
}

export async function renderSemiPrestasiCompactDrawSheetPdf(
  model: ExportModel,
  opts: RenderOptions,
  categoryId: string | null = null,
): Promise<Uint8Array> {
  const { html, headerTitle } = buildSemiPrestasiCompactSheetHtml(model, opts, categoryId);
  return renderHtmlToPdf(html, {
    headerTemplate: headerTemplate(headerTitle),
    footerTemplate: footerTemplate(),
    landscape: true,
  });
}
