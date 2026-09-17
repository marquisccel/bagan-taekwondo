import type { ExportBracket, ExportBracketSlot, ExportFeeder, ExportMatch, ExportModel } from '../model.js';
import {
  esc,
  footerTemplate,
  headerTemplate,
  metaBlockHtml,
  pageShell,
  type RenderOptions,
} from './layout.js';
import { renderHtmlToPdf } from './render.js';

const feederLabel = (f: ExportFeeder): string =>
  f.kind === 'slot' ? `Slot ${f.slot + 1}` : `Pemenang ${f.publicCode ?? '?'}`;

function roundOneHtml(slots: readonly ExportBracketSlot[]): string {
  const rows = slots
    .map(
      (s) => `<tr>
        <td>${s.position + 1}</td>
        <td>${s.isBye ? '<span class="bye">BYE</span>' : esc(s.entry?.displayName ?? '')}</td>
        <td>${s.isBye ? '' : esc(s.entry?.contingent ?? '')}</td>
        <td>${s.seedNo ?? ''}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="section">
      <h3>Slot Awal</h3>
      <table>
        <thead><tr><th style="width:12mm">Slot</th><th>Peserta</th><th>Kontingen</th><th style="width:14mm">Unggulan</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function matchRowHtml(m: ExportMatch): string {
  return `<tr>
    <td>${esc(m.publicCode ?? m.matchUid)}</td>
    <td>${esc(feederLabel(m.feederA))}</td>
    <td>${esc(feederLabel(m.feederB))}</td>
    <td>${esc(m.status)}</td>
  </tr>`;
}

function roundHtml(round: number, matches: readonly ExportMatch[]): string {
  return `
    <div class="section">
      <h3>Babak ${round}</h3>
      <table>
        <thead><tr><th style="width:24mm">Kode</th><th>Sisi A</th><th>Sisi B</th><th style="width:24mm">Status</th></tr></thead>
        <tbody>${matches.map(matchRowHtml).join('')}</tbody>
      </table>
    </div>
  `;
}

function bracketBodyHtml(bracket: ExportBracket): string {
  const rounds = [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b);
  const byRound = (r: number) => bracket.matches.filter((m) => m.round === r);
  return `
    <div class="meta">Ukuran bagan: ${bracket.size} slot &middot; ${bracket.rounds} babak &middot; ${bracket.entries} peserta &middot; ${bracket.byes} BYE</div>
    ${roundOneHtml(bracket.slots)}
    ${rounds.map((r) => roundHtml(r, byRound(r))).join('')}
  `;
}

export async function renderBracketSheetPdf(
  model: ExportModel,
  poolId: string,
  opts: RenderOptions,
): Promise<Uint8Array> {
  const category = model.categories.find((c) => c.pools.some((p) => p.id === poolId));
  const pool = category?.pools.find((p) => p.id === poolId);
  if (!category || !pool) throw new Error(`pool ${poolId} not found in export model`);
  if (!pool.bracket) throw new Error(`pool ${poolId} has no bracket (walkover pools have none)`);

  const title = `Bagan Pertandingan — ${category.categoryKey} — Pool ${pool.ordinal}`;
  const body = `
    <h1>Bagan Pertandingan</h1>
    ${metaBlockHtml(model, opts)}
    <div class="meta"><strong>${esc(category.categoryKey)}</strong> &middot; Pool ${pool.ordinal}</div>
    ${bracketBodyHtml(pool.bracket)}
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(
      `${model.tournament.name} — ${category.categoryKey} — Pool ${pool.ordinal}`,
    ),
    footerTemplate: footerTemplate(),
  });
}
