import type { ExportEntry, ExportModel, ExportPool } from '../model.js';
import {
  formatCategoryDisplayName,
  formatLabel,
  genderLabel,
  humanizeCode,
  warningLabel,
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

const DASH = '—';
const joinAthleteField = (
  e: ExportEntry,
  pick: (a: ExportEntry['athletes'][number]) => string | number | null,
): string =>
  e.athletes
    .map((a) => pick(a))
    .filter((v): v is string | number => v !== null)
    .join(' / ') || DASH;

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
    <td>${esc(joinAthleteField(e, (a) => (a.weightG !== null ? `${(a.weightG / 1000).toFixed(1)} kg` : null)))}</td>
    <td>${esc(joinAthleteField(e, (a) => (a.heightMm !== null ? `${a.heightMm} mm` : null)))}</td>
    <td>${esc(joinAthleteField(e, (a) => a.beltCode))}</td>
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
    <td>${esc(category.movement ? humanizeCode(category.movement) : DASH)}</td>
    <td>${esc(formatLabel(category.format))}</td>
    <td>${esc(genderLabel(category.gender))}</td>
    <td>${esc(joinAthleteField(e, (a) => a.beltCode))}</td>
  </tr>`;
}

function warningsHtml(warnings: readonly string[]): string {
  if (warnings.length === 0) return '';
  return `<div class="warn">${warnings
    .map((code) => `${esc(warningLabel(code))} <span class="code-tag">(${esc(code)})</span>`)
    .join('<br>')}</div>`;
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
    ? ['Posisi', 'Peserta', 'Kontingen', 'Berat', 'Tinggi', 'Sabuk']
    : ['Posisi', 'Peserta', 'Kontingen', 'Movement', 'Format', 'Jenis Kelamin', 'Sabuk'];
  const rows = pool.members
    .map((e, i) => (isKyorugi ? kyorugiRow(pool, e, i) : poomsaeRow(pool, category, e, i)))
    .join('');

  const displayName = formatCategoryDisplayName(category);
  const title = `Lembar Pool — ${displayName} — Pool ${pool.ordinal}`;
  const body = `
    <div class="doc-kicker">Lembar Pool</div>
    <h1>${esc(displayName)}</h1>
    ${metaBlockHtml(model, opts)}
    <div class="meta">Pool ${pool.ordinal}${pool.isWalkover ? ' (Walkover)' : ''}</div>
    ${warningsHtml(pool.warnings)}
    <table>
      <thead><tr>${headCols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headCols.length}">Tidak ada peserta</td></tr>`}</tbody>
    </table>
    <div class="tech-meta">Kunci kategori (teknis): ${esc(category.categoryKey)}</div>
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(`${model.tournament.name} — ${displayName} — Pool ${pool.ordinal}`),
    footerTemplate: footerTemplate(),
  });
}
