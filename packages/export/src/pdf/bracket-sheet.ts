import type { ExportBracket, ExportBracketSlot, ExportFeeder, ExportMatch, ExportModel } from '../model.js';
import { formatOperatorCategoryTitle, matchStatusLabel } from '../presentation.js';
import { renderBracketSvg } from './bracket-svg.js';
import { tileBracketMatches, type BracketTile } from './bracket-tiling.js';
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
        <td class="num">${s.position + 1}</td>
        <td>${s.isBye ? '<span class="bye">BYE</span>' : esc(s.entry?.displayName ?? '')}</td>
        <td>${s.isBye ? '' : esc(s.entry?.contingent ?? '')}</td>
        <td class="num">${s.seedNo ?? ''}</td>
      </tr>`,
    )
    .join('');
  // Explicit fixed column widths (table refinement §7): Kontingen is bounded rather than left to
  // consume whatever the browser's auto layout doesn't give Peserta, and Unggulan is wide enough
  // that the single word never wraps ("Ungg" / "ulan"). Peserta is the sole unset column, so it
  // gets whatever remains — the widest column, as intended. Slot/Unggulan are short numbers, so both
  // they and their headers are centered rather than left-aligned (visual polish pass).
  return `
    <div class="section">
      <h3>Slot Awal</h3>
      <table style="table-layout: fixed">
        <colgroup><col style="width:12mm"><col><col style="width:44mm"><col style="width:22mm"></colgroup>
        <thead><tr><th class="num">Slot</th><th>Peserta</th><th>Kontingen</th><th class="num">Unggulan</th></tr></thead>
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
    <td>${esc(matchStatusLabel(m.status))}</td>
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

/**
 * `forceNewPage`: only a bracket large enough to need multiple visual tiles gets its round-by-round
 * list pushed to a fresh page — a small semi-prestasi bracket (1 tile, e.g. a 3- or 4-person pool)
 * keeps both on the same page (PDF Presentation Remediation §11: never make the operator turn a page
 * merely to understand a 3-person bracket).
 */
function daftarPertandinganHtml(bracket: ExportBracket, forceNewPage: boolean): string {
  const rounds = [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b);
  const byRound = (r: number) => bracket.matches.filter((m) => m.round === r);
  return `
    <div class="${forceNewPage ? 'page-break' : 'section'}">
      <h2>Daftar Pertandingan</h2>
      ${roundOneHtml(bracket.slots)}
      ${rounds.map((r) => roundHtml(r, byRound(r))).join('')}
    </div>
  `;
}

/**
 * The visual bracket itself (ACCEPTANCE §4): one or more tiled diagrams (bracket-tiling.ts) so a
 * 128-entry bracket never gets forced onto one unreadable page, each drawn purely from the
 * persisted feeder graph (bracket-geometry.ts / bracket-svg.ts) — no recomputation of who plays
 * whom. The round-by-round table remains afterward as the existing, already-tested "Daftar
 * Pertandingan" reference list.
 */
function visualBracketHtml(tiles: readonly BracketTile[], bracket: ExportBracket): string {
  const sections = tiles.map((tile, i) => {
    const svg = renderBracketSvg(tile, bracket.rounds);
    const label = tile.label ? `<h3>${esc(tile.label)}</h3>` : '';
    return `<div class="${i === 0 ? '' : 'page-break'} section">${label}${svg}</div>`;
  });
  return `
    <div class="meta">Ukuran bagan: ${bracket.size} slot &middot; ${bracket.rounds} babak &middot; ${bracket.entries} peserta &middot; ${bracket.byes} BYE</div>
    ${tiles.length > 1 ? `<div class="meta">Bagan ditampilkan dalam ${tiles.length} bagian karena ukurannya besar. Setiap "Pemenang &lt;kode&gt;" merujuk pertandingan pada bagian lain.</div>` : ''}
    ${sections.join('')}
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

  const tiles = tileBracketMatches(pool.bracket);
  const displayName = formatOperatorCategoryTitle(category);
  const title = `Bagan Pertandingan · ${displayName} · Pool ${pool.ordinal}`;
  const body = `
    <div class="doc-kicker">Bagan Pertandingan</div>
    <h1>${esc(displayName)}</h1>
    ${metaBlockHtml(model, opts)}
    <div class="meta">Pool ${pool.ordinal}</div>
    ${visualBracketHtml(tiles, pool.bracket)}
    ${daftarPertandinganHtml(pool.bracket, tiles.length > 1)}
  `;
  return renderHtmlToPdf(pageShell(title, body, opts), {
    headerTemplate: headerTemplate(`${model.tournament.name} · ${displayName} · Pool ${pool.ordinal}`),
    footerTemplate: footerTemplate(),
  });
}
