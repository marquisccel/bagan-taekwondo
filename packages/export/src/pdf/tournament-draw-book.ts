import type { ExportCategory, ExportModel, ExportPool } from '../model.js';
import { disciplineLabel, formatCategoryDisplayName, readinessLabel, warningLabel } from '../presentation.js';
import {
  esc,
  footerTemplate,
  headerTemplate,
  metaBlockHtml,
  pageShell,
  type RenderOptions,
} from './layout.js';
import { renderHtmlToPdf } from './render.js';

function warningsHtml(warnings: readonly string[]): string {
  if (warnings.length === 0) return '';
  return `<div class="warn">${warnings
    .map((code) => `${esc(warningLabel(code))} <span class="code-tag">(${esc(code)})</span>`)
    .join('<br>')}</div>`;
}

function poolBlockHtml(p: ExportPool): string {
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

function categoryBlockHtml(c: ExportCategory, first: boolean): string {
  const displayName = formatCategoryDisplayName(c);
  return `
    <div class="${first ? '' : 'page-break'}">
      <div class="doc-kicker">Kategori</div>
      <h2 id="cat-${esc(c.id)}">${esc(displayName)}</h2>
      <div class="meta">
        <div>Peserta: ${c.participantCount} &middot; Status: ${esc(readinessLabel(c.readiness))}</div>
      </div>
      ${c.pools.map(poolBlockHtml).join('') || '<div class="meta">Belum ada pool.</div>'}
      <div class="tech-meta">Kunci kategori (teknis): ${esc(c.categoryKey)}</div>
    </div>
  `;
}

function indexHtml(categories: readonly ExportCategory[]): string {
  const rows = categories
    .map(
      (c) =>
        `<tr><td>${esc(formatCategoryDisplayName(c))}</td><td>${esc(disciplineLabel(c.discipline))}</td><td>${c.participantCount}</td></tr>`,
    )
    .join('');
  return `
    <h2>Daftar Kategori</h2>
    <table>
      <thead><tr><th>Kategori</th><th>Cabang</th><th>Peserta</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * The consolidated draw book. Deliberately implemented last (ACCEPTANCE §4) and built entirely
 * from the same per-category/pool blocks CATEGORY_DRAW uses — no separate logic path that could
 * drift from the single-category document. Category titles repeat via an in-flow `<h2>` per
 * category rather than a page-header bar, because Playwright's PDF header/footer template is fixed
 * for the whole document and cannot vary per page short of pre-computing page numbers per section.
 */
export async function renderTournamentDrawBookPdf(
  model: ExportModel,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const title = `Buku Bagan Turnamen — ${model.tournament.name}`;
  const qualityLine =
    model.quality.errorCount || model.quality.warningCount
      ? `<div class="warn">Kualitas: ${model.quality.errorCount} error, ${model.quality.warningCount} peringatan</div>`
      : '';
  const body = `
    <h1>${esc(title)}</h1>
    ${metaBlockHtml(model, opts)}
    ${qualityLine}
    ${indexHtml(model.categories)}
    ${model.categories.map((c, i) => categoryBlockHtml(c, i === 0)).join('')}
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(model.tournament.name),
    footerTemplate: footerTemplate(),
  });
}
