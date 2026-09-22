import type { ExportEntry, ExportModel, ExportPool } from '../model.js';
import {
  beltDisplay,
  formatHeightCm,
  formatLabel,
  formatOperatorCategoryTitle,
  formatWeightKg,
  genderLabel,
  humanizeCode,
  MISSING_VALUE,
  SEMI_PRESTASI_COMPACT_LABEL as L,
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

function kyorugiRow(pool: ExportPool, e: ExportEntry, index: number): string {
  return `<tr>
    <td>${positionOf(pool, e, index)}</td>
    <td>${esc(e.displayName)}</td>
    <td>${esc(e.contingent)}</td>
    <td>${esc(joinAthleteField(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}</td>
    <td>${esc(joinAthleteField(e, (a) => formatHeightCm(a.heightMm)))}</td>
    <td>${esc(joinAthleteField(e, (a) => formatWeightKg(a.weightG)))}</td>
  </tr>`;
}

function poomsaeRow(
  pool: ExportPool,
  category: ExportModel['categories'][number],
  e: ExportEntry,
  index: number,
): string {
  return `<tr>
    <td>${positionOf(pool, e, index)}</td>
    <td>${esc(e.displayName)}</td>
    <td>${esc(e.contingent)}</td>
    <td>${esc(category.movement ? humanizeCode(category.movement) : MISSING_VALUE)}</td>
    <td>${esc(formatLabel(category.format))}</td>
    <td>${esc(genderLabel(category.gender))}</td>
    <td>${esc(joinAthleteField(e, (a) => beltDisplay(a.beltCode, a.beltLabel)))}</td>
  </tr>`;
}

export async function renderPoolSheetPdf(
  model: ExportModel,
  poolId: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const category = model.categories.find((c) => c.pools.some((p) => p.id === poolId));
  const pool = category?.pools.find((p) => p.id === poolId);
  if (!category || !pool) throw new Error(`pool ${poolId} not found in export model`);

  const isKyorugi = category.discipline === 'KYORUGI';
  const headCols = isKyorugi
    ? ['Posisi', L.participant, L.contingent, L.belt, L.heightCm, L.weightKg]
    : ['Posisi', L.participant, L.contingent, L.movement, L.format, 'Jenis Kelamin', L.belt];
  const rows = pool.members
    .map((e, i) => (isKyorugi ? kyorugiRow(pool, e, i) : poomsaeRow(pool, category, e, i)))
    .join('');

  const displayName = formatOperatorCategoryTitle(category);
  const title = `Lembar Pool — ${displayName} — Pool ${pool.ordinal}`;
  const body = `
    <div class="doc-kicker">Lembar Pool</div>
    <h1>${esc(displayName)}</h1>
    ${metaBlockHtml(model, opts)}
    <div class="meta">Pool ${pool.ordinal}${pool.isWalkover ? ' (Walkover)' : ''}</div>
    <table>
      <thead><tr>${headCols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headCols.length}">${esc(L.noParticipants)}</td></tr>`}</tbody>
    </table>
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(`${model.tournament.name} — ${displayName} — Pool ${pool.ordinal}`),
    footerTemplate: footerTemplate(),
  });
}
