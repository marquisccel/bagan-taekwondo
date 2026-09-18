import { matchStatusLabel } from '../presentation.js';
import {
  computeBracketGeometry,
  LEAF_LABEL_WIDTH,
  ROW_HEIGHT,
  type BracketGeometry,
} from './bracket-geometry.js';
import { esc } from './layout.js';
import type { BracketTile } from './bracket-tiling.js';

const MARGIN = 14;

function textEl(
  x: number,
  y: number,
  text: string,
  opts: { bold?: boolean; italic?: boolean; size?: number; fill?: string } = {},
): string {
  const weight = opts.bold ? ' font-weight="700"' : '';
  const style = opts.italic ? ' font-style="italic"' : '';
  const size = opts.size ?? 9;
  const fill = opts.fill ?? '#111';
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="Segoe UI, Arial, sans-serif" fill="${fill}"${weight}${style}>${esc(text)}</text>`;
}

/**
 * Renders one bracket tile as a self-contained inline SVG (ACCEPTANCE §4): competitors on the
 * left, rounds progressing left-to-right, elbow connectors showing exactly which feeders join into
 * which match (read straight from `ExportFeeder` — never inferred), BYE and the true final clearly
 * marked. Geometry is deterministic (bracket-geometry.ts); this file only turns coordinates into
 * SVG markup.
 */
export function renderBracketSvg(tile: BracketTile, finalRound: number): string {
  const geometry: BracketGeometry = computeBracketGeometry(tile.matches, tile.slots);
  const width = geometry.width + MARGIN * 2;
  const height = geometry.height + MARGIN * 2;

  const parts: string[] = [];

  for (const leaf of geometry.leaves) {
    const y = leaf.y + MARGIN + ROW_HEIGHT / 2;
    if (leaf.isBye) {
      parts.push(textEl(MARGIN, y + 3, 'BYE', { italic: true, fill: '#888' }));
    } else {
      parts.push(textEl(MARGIN, y - 1, leaf.label, { bold: !leaf.isVirtual }));
      if (leaf.sublabel) parts.push(textEl(MARGIN, y + 9, leaf.sublabel, { size: 7, fill: '#666' }));
      if (leaf.isVirtual)
        parts.push(textEl(MARGIN, y + 9, '(dari tile lain)', { size: 6.5, fill: '#999', italic: true }));
    }
    // Leaf baseline separator so dense rosters stay readable.
    parts.push(
      `<line x1="0" y1="${leaf.y + MARGIN + ROW_HEIGHT}" x2="${LEAF_LABEL_WIDTH - 8}" y2="${leaf.y + MARGIN + ROW_HEIGHT}" stroke="#eee" stroke-width="1"/>`,
    );
  }

  for (const node of geometry.matches) {
    const x = node.x + MARGIN;
    const prevX = node.prevX + MARGIN;
    const y = node.y + MARGIN + ROW_HEIGHT / 2;
    const ay = node.feederAY + MARGIN + ROW_HEIGHT / 2;
    const by = node.feederBY + MARGIN + ROW_HEIGHT / 2;
    const midX = prevX + (x - prevX) / 2;
    const isFinal = node.match.round === finalRound;
    const stroke = isFinal ? '#111' : '#888';
    const strokeWidth = isFinal ? 1.6 : 1;

    parts.push(
      `<path d="M ${prevX} ${ay} H ${midX} V ${by} M ${prevX} ${by} H ${midX}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
      `<line x1="${midX}" y1="${y}" x2="${x}" y2="${y}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
      `<line x1="${x}" y1="${y - 8}" x2="${x}" y2="${y + 8}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );
    const codeLabel = node.match.publicCode ?? node.match.matchUid;
    parts.push(textEl(x + 4, y - 5, codeLabel, { bold: isFinal, size: isFinal ? 9.5 : 8 }));
    if (node.match.status !== 'PENDING') {
      parts.push(textEl(x + 4, y + 9, matchStatusLabel(node.match.status), { size: 6.5, fill: '#a66' }));
    }
    if (isFinal) parts.push(textEl(x + 4, y - 15, 'FINAL', { bold: true, size: 7.5, fill: '#a33' }));
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
