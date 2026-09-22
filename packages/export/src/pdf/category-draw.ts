import type { ExportCategory, ExportModel, ExportPool } from '../model.js';
import {
  formatCategoryDisplayName,
  formatLabel,
  genderLabel,
  humanizeCode,
  qualitySummaryLabel,
  readinessLabel,
  streamLabel,
  warningLabel,
  weightClassLabel,
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

function categoryInfoRows(c: ExportCategory): string {
  const rows: [string, string | null][] = [
    ['Kelompok', streamLabel(c.stream)],
    ['Kelas usia', c.ageDivisionLabel ?? (c.ageDivisionCode ? humanizeCode(c.ageDivisionCode) : null)],
    ['Jenis kelamin', genderLabel(c.gender)],
    ['Kelas berat', c.weightClassCode ? weightClassLabel(c.weightClassCode) : null],
    ['Movement', c.movement ? humanizeCode(c.movement) : null],
    ['Format', formatLabel(c.format)],
    ['Jumlah peserta', String(c.participantCount)],
    ['Status kesiapan', readinessLabel(c.readiness)],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<tr><th style="width:40mm">${esc(k)}</th><td>${esc(String(v))}</td></tr>`)
    .join('');
}

function warningsHtml(warnings: readonly string[]): string {
  if (warnings.length === 0) return '';
  return `<div class="warn">${warnings
    .map((code) => `${esc(warningLabel(code))} <span class="code-tag">(${esc(code)})</span>`)
    .join('<br>')}</div>`;
}

function poolSummaryHtml(p: ExportPool): string {
  const roster = p.members
    .map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName)}</td><td>${esc(e.contingent)}</td></tr>`)
    .join('');
  const bracketNote = p.bracket
    ? `<div class="meta">Bagan: ${p.bracket.size} slot, ${p.bracket.rounds} babak, ${p.bracket.byes} BYE</div>`
    : '';
  return `
    <div class="section">
      <h3>Pool ${p.ordinal}${p.isWalkover ? ' (Walkover)' : ''}</h3>
      ${warningsHtml(p.warnings)}
      ${bracketNote}
      <table>
        <thead><tr><th style="width:10mm">No</th><th>Peserta</th><th>Kontingen</th></tr></thead>
        <tbody>${roster || '<tr><td colspan="3">Tidak ada peserta</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

/**
 * CATEGORY_DRAW is the AUDIT/ANALYSIS document for one category (PDF Presentation Remediation §10):
 * "Laporan Analisis Drawing". Unlike the operational documents (the compact semi-prestasi sheet,
 * POOL_SHEET, BRACKET_SHEET), this is where engine reason codes, pool-quality warnings and technical
 * identifiers (the raw category key) genuinely belong and remain fully visible — nothing here was
 * deleted, only the operational documents had it moved out.
 */
export async function renderCategoryDrawPdf(
  model: ExportModel,
  categoryId: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const category = model.categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`category ${categoryId} not found in export model`);

  const displayName = formatCategoryDisplayName(category);
  const qualitySummary = qualitySummaryLabel(model.quality);
  const body = `
    <div class="doc-kicker">Laporan Analisis Drawing</div>
    <h1>${esc(displayName)}</h1>
    ${metaBlockHtml(model, opts)}
    ${qualitySummary ? `<div class="warn">${esc(qualitySummary)}</div>` : ''}
    <table>${categoryInfoRows(category)}</table>
    ${category.pools.map(poolSummaryHtml).join('')}
    <div class="tech-meta">Kunci kategori (teknis): ${esc(category.categoryKey)}</div>
  `;
  return renderHtmlToPdf(pageShell(displayName, body, opts), {
    headerTemplate: headerTemplate(`${model.tournament.name} — ${displayName}`),
    footerTemplate: footerTemplate(),
  });
}
