import type { ExportEntry, ExportModel, ExportPool } from '../model.js';
import {
  beltDisplay,
  formatLabel,
  formatOperatorCategoryTitle,
  genderLabel,
  heightCmDisplay,
  humanizeCode,
  MISSING_VALUE,
  SEMI_PRESTASI_COMPACT_LABEL as L,
  weightKgDisplay,
} from '../presentation.js';
import {
  esc,
  footerTemplate,
  headerTemplate,
  metaBlockHtml,
  pageShell,
  type RenderOptions,
} from './layout.js';
import { renderHtmlToPdf } from './render.js';

/**
 * POOL_SHEET is an OPERATIONAL document (tournament desk / competition area, PDF Presentation
 * Remediation §11): participant identity, contingent, belt, height, weight and Poomsae movement
 * only. It never shows a raw engine reason code or the raw category key — those belong to the
 * audit-oriented CATEGORY_DRAW document (category-draw.ts), which still carries them in full.
 */
const joinAthleteField = (e: ExportEntry, pick: (a: ExportEntry['athletes'][number]) => string): string =>
  e.athletes.length === 0 ? MISSING_VALUE : e.athletes.map(pick).join(' / ');

/** Position within the pool: the bracket slot position when a bracket exists, else 1-based list order. */
function positionOf(pool: ExportPool, entry: ExportEntry, index: number): number {
  const slot = pool.bracket?.slots.find((s) => s.entry?.id === entry.id);
  return slot ? slot.position + 1 : index + 1;
}

/** Belt/height/weight are drawing inputs, not opponent-facing information (PDF Presentation
 * Remediation, official privacy) — omitted entirely for OFFICIAL; PREVIEW keeps them for panitia
 * review. Presentation-only: `ExportModel` itself is untouched. */
function kyorugiRow(pool: ExportPool, e: ExportEntry, index: number, official: boolean): string {
  const measurementCells = official
    ? ''
    : `<td>${esc(joinAthleteField(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}</td>
    <td>${esc(joinAthleteField(e, (a) => heightCmDisplay(a.heightMm)))}</td>
    <td>${esc(joinAthleteField(e, (a) => weightKgDisplay(a.weightG)))}</td>`;
  return `<tr>
    <td class="num">${positionOf(pool, e, index)}</td>
    <td>${esc(e.displayName)}</td>
    <td>${esc(e.contingent)}</td>
    ${measurementCells}
  </tr>`;
}

function poomsaeRow(
  pool: ExportPool,
  category: ExportModel['categories'][number],
  e: ExportEntry,
  index: number,
  official: boolean,
): string {
  const beltCell = official
    ? ''
    : `<td>${esc(joinAthleteField(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}</td>`;
  return `<tr>
    <td class="num">${positionOf(pool, e, index)}</td>
    <td>${esc(e.displayName)}</td>
    <td>${esc(e.contingent)}</td>
    <td>${esc(category.movement ? humanizeCode(category.movement) : MISSING_VALUE)}</td>
    <td>${esc(formatLabel(category.format))}</td>
    <td>${esc(genderLabel(category.gender))}</td>
    ${beltCell}
  </tr>`;
}

export interface PoolSheetHtml {
  readonly title: string;
  readonly html: string;
  readonly headerTitle: string;
}

/** Split out from `renderPoolSheetPdf` so tests can assert on the HTML directly instead of a
 * rendered PDF's bytes (fast, no headless Chromium needed for content-level checks). */
export function buildPoolSheetHtml(model: ExportModel, poolId: string, opts: RenderOptions): PoolSheetHtml {
  const category = model.categories.find((c) => c.pools.some((p) => p.id === poolId));
  const pool = category?.pools.find((p) => p.id === poolId);
  if (!category || !pool) throw new Error(`pool ${poolId} not found in export model`);

  const isKyorugi = category.discipline === 'KYORUGI';
  const official = opts.mode === 'OFFICIAL';
  const headCols = isKyorugi
    ? official
      ? ['Posisi', L.participant, L.contingent]
      : ['Posisi', L.participant, L.contingent, L.belt, L.heightCm, L.weightKg]
    : official
      ? ['Posisi', L.participant, L.contingent, L.movement, L.format, 'Jenis Kelamin']
      : ['Posisi', L.participant, L.contingent, L.movement, L.format, 'Jenis Kelamin', L.belt];
  // Explicit, fixed proportional column widths (visual polish pass): an auto-sized table left the
  // last column's right border a fraction of a pixel narrower than the others, visible as a
  // noticeably thinner line at print resolution. Posisi is centered like the compact sheet's; Peserta
  // is the sole unset column, so it gets whatever remains (the widest, as intended).
  const colWidths = isKyorugi
    ? official
      ? ['18mm', null, '30%']
      : ['18mm', null, '23%', '15%', '15%', '15%']
    : official
      ? ['18mm', null, '25%', '15%', '14%', '14%']
      : ['18mm', null, '21%', '13%', '12%', '12%', '13%'];
  const rows = pool.members
    .map((e, i) =>
      isKyorugi ? kyorugiRow(pool, e, i, official) : poomsaeRow(pool, category, e, i, official),
    )
    .join('');

  const displayName = formatOperatorCategoryTitle(category);
  const title = `Lembar Pool · ${displayName} · Pool ${pool.ordinal}`;
  const body = `
    <div class="doc-kicker">Lembar Pool</div>
    <h1>${esc(displayName)}</h1>
    ${metaBlockHtml(model, opts)}
    <div class="meta">Pool ${pool.ordinal}${pool.isWalkover ? ' (Walkover)' : ''}</div>
    <table style="table-layout: fixed">
      <colgroup>${colWidths.map((w) => (w ? `<col style="width:${w}">` : '<col>')).join('')}</colgroup>
      <thead><tr>${headCols.map((h, i) => `<th${i === 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headCols.length}">${esc(L.noParticipants)}</td></tr>`}</tbody>
    </table>
  `;
  return {
    title,
    html: pageShell(title, body, opts),
    headerTitle: `${model.tournament.name} · ${displayName} · Pool ${pool.ordinal}`,
  };
}

export async function renderPoolSheetPdf(
  model: ExportModel,
  poolId: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const { html, headerTitle } = buildPoolSheetHtml(model, poolId, opts);
  return renderHtmlToPdf(html, {
    headerTemplate: headerTemplate(headerTitle),
    footerTemplate: footerTemplate(),
  });
}
