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

/** DIVISI_USIA=... / WEIGHT_CLASS=... style tokens embedded in categoryKey by the Phase 3 engine. */
function keyPart(categoryKey: string, tag: string): string | null {
  const m = new RegExp(`\\|${tag}=([^|]*)`).exec(categoryKey);
  return m?.[1] ?? null;
}

function categoryInfoRows(c: ExportCategory): string {
  const rows: [string, string | null][] = [
    ['Cabang', c.discipline],
    ['Kelas usia', c.ageDivisionCode ?? keyPart(c.categoryKey, 'AGE_DIVISION')],
    ['Jenis kelamin', c.gender],
    ['Kelas berat', c.weightClassCode],
    ['Movement', c.movement],
    ['Format', c.format],
    ['Jumlah peserta', String(c.participantCount)],
    ['Status kesiapan', c.readiness],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<tr><th style="width:40mm">${esc(k)}</th><td>${esc(String(v))}</td></tr>`)
    .join('');
}

function poolSummaryHtml(p: ExportPool): string {
  const roster = p.members
    .map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.displayName)}</td><td>${esc(e.contingent)}</td></tr>`)
    .join('');
  const bracketNote = p.bracket
    ? `<div class="meta">Bagan: ${p.bracket.size} slot, ${p.bracket.rounds} babak, ${p.bracket.byes} BYE</div>`
    : '';
  const warnings = p.warnings.length
    ? `<div class="warn">Peringatan: ${p.warnings.map(esc).join('; ')}</div>`
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

export async function renderCategoryDrawPdf(
  model: ExportModel,
  categoryId: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const category = model.categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`category ${categoryId} not found in export model`);

  const title = `Bagan Kategori — ${category.categoryKey}`;
  const body = `
    <h1>${esc(title)}</h1>
    ${metaBlockHtml(model, opts)}
    <table>${categoryInfoRows(category)}</table>
    ${category.pools.map(poolSummaryHtml).join('')}
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(`${model.tournament.name} — ${category.categoryKey}`),
    footerTemplate: footerTemplate(),
  });
}
