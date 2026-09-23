import type { ExportAthleteDisplay, ExportCategory, ExportEntry, ExportModel, ExportPool } from '../model.js';
import {
  beltDisplay,
  disciplineLabel,
  formatHeightCm,
  formatLabel,
  formatOperatorCategoryTitle,
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
 * Landscape, one pool per row, full page content width (table refinement — layout correction): every
 * pool card spans the full width of the page rather than sharing a 2-column grid, with the
 * participant table on the left and a substantially larger, easier-to-read bracket on the right.
 * A pool's row height is whatever its own content needs (a 2-person pool is naturally shorter than
 * a 4-person one) — never artificially stretched. This trades page density for readability: a large
 * category simply spans more pages, which is the accepted, intended outcome.
 */

/** Bracket drawing area (CSS px, ~ the row's bracket-column width) — one size for every pool now that
 * every row is full width; the physical container width (not this nominal size) is what makes the
 * bracket look larger on the page, since the SVG always scales to fill its container. */
const POOL_BRACKET_AREA = { width: 640, leafWidth: 130, nameChars: 30 } as const;

/**
 * A pool whose table is roughly a page tall (>= ~30 participants) may fragment across pages; keeping it in
 * one piece would push it to a fresh page and leave the category heading stranded on a blank one.
 */
const TALL_CARD_MIN_LINES = 60;

const COMPACT_CSS = `
  body { font-size: 7.5pt; line-height: 1.25; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm;
    border-bottom: 0.8pt solid #111; padding-bottom: 1.5mm; margin-bottom: 2.5mm; }
  .doc-head h1 { font-size: 13pt; margin: 0; }
  .doc-head .doc-kicker { margin-bottom: 0.5mm; }
  .doc-category { font-size: 9pt; font-weight: 600; color: #222; margin-top: 0.5mm; }
  .doc-meta { font-size: 7pt; color: #333; text-align: right; line-height: 1.35; }
  .doc-mode { font-weight: 700; }
  .quality-line { font-size: 7pt; color: #7a4b00; margin: 0 0 2mm; }
  /* A plain heading (no boxed/backgrounded banner) before a category's pools -- only shown for a
     REVISION-scope document with more than one category; a CATEGORY-scoped export already shows its
     one category's title in the main doc header (docHeader()), so it is never repeated here. */
  .cat-heading { font-size: 10pt; font-weight: 700; margin: 4mm 0 2mm; page-break-after: avoid; }
  .cat-info { font-size: 7pt; color: #333; margin: -1.5mm 0 2mm; }
  .card { border: 0.5pt solid #555; break-inside: avoid; page-break-inside: avoid; overflow: hidden;
    margin-bottom: 2.5mm; }
  .card.tall { break-inside: auto; page-break-inside: auto; }
  /* Left padding matches the table's own first-cell inset (0.3pt border + 1mm padding) so "Pool N"
     starts flush with the "No" column below it, instead of noticeably further right (visual polish). */
  .card-head { background: #fff; border-bottom: 0.5pt solid #555; padding: 1mm 2mm 1mm 1.1mm; }
  .card-head .row { display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
  .pool-no { font-size: 9pt; font-weight: 700; }
  .pool-flag { font-size: 6.5pt; font-weight: 700; color: #a33; margin-left: 1.5mm; }
  .card-count { font-size: 7pt; color: #333; white-space: nowrap; }
  /* One pool per row, spanning the full page width (table refinement -- layout correction): the
     participant table gets a modest, fixed share and the bracket -- now substantially larger since
     its container is the full page width, not half of a 2-column grid -- gets the rest. */
  /* Vertically centered (visual polish pass): the participant table is usually the taller of the
     two (multi-row roster vs. a compact diagram), so a top-aligned bracket used to sit flush with
     the table's first row, leaving blank space below it instead of being centered in the row. */
  .card-body { padding: 0; display: flex; gap: 4mm; align-items: center; }
  .card-body .col-table { width: 42%; flex: none; min-width: 0; }
  .card-body .col-bracket { flex: 1; min-width: 0; }
  table.pt { margin: 0; width: 100%; table-layout: fixed; }
  /* Header and body share the same font size/padding (visual polish pass) -- only the background and
     weight distinguish the header row now, instead of a visibly smaller, more cramped header. */
  table.pt th, table.pt td { font-size: 7pt; padding: 0.3mm 1mm; border: 0.3pt solid #bbb; line-height: 1.15; }
  table.pt th { background: #e8e8e8; white-space: nowrap; }
  table.pt th.wrap-ok { white-space: normal; }
  table.pt tr { break-inside: avoid; page-break-inside: avoid; }
  table.pt td.num, table.pt th.num { text-align: center; }
  /* Peserta/Kontingen/Sabuk are visually clamped to 2 lines (with an ellipsis) so one very long value
     never stretches a whole pool card -- the full text still round-trips through this same HTML,
     unclamped, to POOL_SHEET/XLSX/the DOM itself; only how this document paints it is bounded
     (table refinement pass, items 3-5). Each is its own td (never nested/stacked with another
     field) so a print operator can scan participant, contingent and belt independently -- the clamp
     itself lives on a div INSIDE the cell, never on the td itself, since the -webkit-box display it
     needs overrides a table cell's own table-cell display and desynchronizes it from the row height. */
  table.pt .clamp2 { overflow-wrap: break-word; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; overflow: hidden; }
  table.pt .nm { font-weight: 600; }
  table.pt .ct { font-size: 6.2pt; color: #333; }
  table.pt .na { color: #666; }
  .col-bracket, .bk { padding: 0.5mm 1.2mm 0.3mm; }
  .bk-note { font-size: 6.5pt; color: #555; font-style: italic; padding: 0.8mm 1.5mm; }
  .card-foot { border-top: 0.3pt solid #bbb; padding: 0.5mm 1.5mm; font-size: 6.3pt; color: #7a4b00; line-height: 1.25; }
  .card-foot .code-tag { font-size: 5.5pt; color: #8a7a60; }
  .card-foot .gap { color: #555; }
`;

const NUMBER_COL = '5.5mm';
/** Percentages of the whole table (not the remainder). Kontingen is bounded narrower than Peserta,
 * which is left as the sole unset column and so takes whatever remains -- the widest textual
 * column, as required. Belt was widened once already to stop "Kuning Strip Hijau" wrapping to a
 * second line, then reported as now leaving visible blank space -- trimmed back down to the
 * narrowest width that still keeps that same longest compound color on one line. Height/weight
 * shrank once their headers took the unit ("TB (cm)"/"BB (kg)", see HEIGHT_HEADER/WEIGHT_HEADER
 * below) and their cell values dropped the per-value unit suffix -- "146,4"/"34,75" needs far less
 * room than "146,4 cm"/"34,75 kg" did. */
const BELT_COL = '22%';
const CONTINGENT_COL = '19%';
const HEIGHT_COL = '10%';
const WEIGHT_COL = '10%';
/** Short, unit-bearing headers (visual polish pass) -- the unit now lives in the header once instead
 * of being repeated in every cell value, freeing width previously spent on "Tinggi Badan"/"Berat
 * Badan" plus a per-value " cm"/" kg" suffix. Local to this sheet only: POOL_SHEET (pool-sheet.ts)
 * keeps the full-word `L.heightCm`/`L.weightKg` headers and per-value units, since it isn't under
 * the same per-pool-card width pressure. */
const HEIGHT_HEADER = 'TB (cm)';
const WEIGHT_HEADER = 'BB (kg)';

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

/** Same per-athlete stacking as `valueCell`, but each value gets its own 2-line clamp box — used for
 * the belt column, where a two/three-word color name (never the participant/contingent columns'
 * business) must never grow to a third line even for a pair/team entry's several stacked athletes.
 * Left-aligned like Peserta/Kontingen, not centered like the numeric columns (visual polish pass):
 * a belt color is a text value, not a number, so it follows the text-column convention. */
function beltCell(values: readonly string[]): string {
  const absent = values.every((v) => v === MISSING_VALUE);
  return `<td${absent ? ' class="na"' : ''}>${values.map((v) => `<div class="clamp2">${esc(v)}</div>`).join('')}</td>`;
}

function participantRow(pool: ExportPool, e: ExportEntry, index: number): string {
  return `<tr>
    <td class="num">${positionOf(pool, e, index)}</td>
    <td><div class="nm clamp2">${esc(e.displayName)}</div></td>
    <td><div class="ct clamp2">${e.contingent ? esc(e.contingent) : MISSING_VALUE}</div></td>
    ${beltCell(perAthlete(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}${valueCell(perAthlete(e, (a) => formatHeightCm(a.heightMm)))}${valueCell(perAthlete(e, (a) => formatWeightKg(a.weightG)))}
  </tr>`;
}

function participantTable(pool: ExportPool): string {
  const rows = pool.members.map((e, i) => participantRow(pool, e, i)).join('');
  return `<table class="pt">
    <colgroup><col style="width:${NUMBER_COL}"><col><col style="width:${CONTINGENT_COL}"><col style="width:${BELT_COL}"><col style="width:${HEIGHT_COL}"><col style="width:${WEIGHT_COL}"></colgroup>
    <thead><tr><th class="num">${esc(L.number)}</th><th>${esc(L.participant)}</th><th>${esc(L.contingent)}</th><th>${esc(L.belt)}</th><th class="num">${esc(HEIGHT_HEADER)}</th><th class="num">${esc(WEIGHT_HEADER)}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6">${esc(L.noParticipants)}</td></tr>`}</tbody>
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
  const tableLines = pool.members.reduce((n, e) => n + Math.max(2, e.athletes.length), 0);
  const tall = tableLines > TALL_CARD_MIN_LINES;
  const bracketBits = pool.bracket
    ? ` &middot; Bagan ${pool.bracket.size} slot${pool.bracket.byes > 0 ? ` &middot; ${pool.bracket.byes} ${L.bye}` : ''}`
    : '';
  // Movement/format sit on the same line as the pool's own metadata, to the right of "Pool N"
  // (visual polish pass) -- no longer a separate line below it.
  const poomsaeBits = isPoomsae
    ? ` &middot; ${esc(L.movement)}: ${esc(category.movement ? humanizeCode(category.movement) : MISSING_VALUE)} &middot; ${esc(L.format)}: ${esc(formatLabel(category.format))}`
    : '';
  // One pool per row, full page width (layout correction): table on the left, bracket on the right.
  // A pool's row is only as tall as its own content -- never stretched to fill the page.
  const body = `<div class="card-body"><div class="col-table">${participantTable(pool)}</div><div class="col-bracket">${bracketHtml(pool, POOL_BRACKET_AREA)}</div></div>`;
  return `<div class="card${tall ? ' tall' : ''}">
    <div class="card-head">
      <div class="row"><span><span class="pool-no">${esc(poolLabel(pool.ordinal))}</span>${pool.isWalkover ? `<span class="pool-flag">${esc(L.walkover.toUpperCase())}</span>` : ''}</span><span class="card-count">${esc(participantCountLabel(pool.members.length))}${bracketBits}${poomsaeBits}</span></div>
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

/**
 * `showHeading`: a CATEGORY-scoped document already shows its one category's title integrated into
 * the main doc header (see `docHeader`/`buildSemiPrestasiCompactSheetHtml`), so nothing repeats it
 * here. A REVISION-scoped document has several categories, so each still needs a plain heading (no
 * boxed/backgrounded banner) to mark where one category's pools end and the next begin.
 */
function categorySection(c: ExportCategory, showHeading: boolean): string {
  const cards = c.pools.map((p) => poolCard(c, p)).join('');
  const heading = showHeading
    ? `<div class="cat-heading">${esc(formatOperatorCategoryTitle(c))}</div><div class="cat-info">${categoryInfoLine(c)}</div>`
    : '';
  return `${heading}${cards || `<div class="bk-note">${esc(L.noPools)}</div>`}`;
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(d);
};

/** `categoryTitle`: for a CATEGORY-scoped document, its one category's title is shown directly under
 * the main document title (table refinement -- layout correction) instead of a separate banner
 * further down the page; `null` for a REVISION-scoped document (there is no single category to name
 * here, and the old generic descriptive sentence is not replaced with anything). */
function docHeader(model: ExportModel, opts: RenderOptions, categoryTitle: string | null): string {
  const categoryLine = categoryTitle ? `<div class="doc-category">${esc(categoryTitle)}</div>` : '';
  return `<div class="doc-head">
    <div>
      <div class="doc-kicker">${esc(model.tournament.name)} (${esc(model.tournament.code)})</div>
      <h1>${esc(L.documentTitle)}</h1>
      ${categoryLine}
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
  const singleCategoryTitle = single ? formatOperatorCategoryTitle(single) : null;
  const title = single
    ? `${L.documentTitle} · ${singleCategoryTitle}`
    : `${L.documentTitle} · ${model.tournament.name}`;
  const body = `${docHeader(model, opts, singleCategoryTitle)}${qualityLine}${categories.map((c) => categorySection(c, !single)).join('')}`;
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
      ? `${model.tournament.name} · ${L.documentTitle} · ${formatOperatorCategoryTitle(single)}`
      : `${model.tournament.name} · ${L.documentTitle}`,
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
