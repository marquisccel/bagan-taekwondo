import type { ExportCategory, ExportModel, ExportPool } from '../model.js';
import {
  esc,
  footerTemplate,
  headerTemplate,
  metaBlockHtml,
  pageShell,
  type RenderOptions,
} from './layout.js';
import { renderHtmlToPdf } from './render.js';

function poolBlockHtml(p: ExportPool): string {
  const roster = p.members
    .map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName)}</td><td>${esc(e.contingent)}</td></tr>`)
    .join('');
  const warnings = p.warnings.length
    ? `<div class="warn">Peringatan: ${p.warnings.map(esc).join('; ')}</div>`
    : '';
  const bracketNote = p.bracket
    ? `<div class="meta">Bagan: ${p.bracket.size} slot, ${p.bracket.rounds} babak, ${p.bracket.byes} BYE</div>`
    : '';
  return `
    <div class="section">
      <h3>Pool ${p.ordinal}${p.isWalkover ? ' (Walkover)' : ''}</h3>
      ${warnings}
      ${bracketNote}
      <table>
        <thead><tr><th style="width:10mm">No</th><th>Peserta</th><th>Kontingen</th></tr></thead>
        <tbody>${roster || '<tr><td colspan="3">Tidak ada peserta</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function categoryBlockHtml(c: ExportCategory, first: boolean): string {
  return `
    <div class="${first ? '' : 'page-break'}">
      <h2 id="cat-${esc(c.id)}">${esc(c.categoryKey)}</h2>
      <div class="meta">
        <div>${esc(c.discipline)} &middot; ${esc(c.gender)}${c.weightClassCode ? ` &middot; ${esc(c.weightClassCode)}` : ''}${c.movement ? ` &middot; ${esc(c.movement)}` : ''}</div>
        <div>Peserta: ${c.participantCount} &middot; Status: ${esc(c.readiness)}</div>
      </div>
      ${c.pools.map(poolBlockHtml).join('') || '<div class="meta">Belum ada pool.</div>'}
    </div>
  `;
}

function indexHtml(categories: readonly ExportCategory[]): string {
  const rows = categories
    .map(
      (c) =>
        `<tr><td>${esc(c.categoryKey)}</td><td>${esc(c.discipline)}</td><td>${c.participantCount}</td></tr>`,
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
