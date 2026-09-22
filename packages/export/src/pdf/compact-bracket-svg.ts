import type { ExportBracket } from '../model.js';
import { matchStatusLabel, SEMI_PRESTASI_COMPACT_LABEL } from '../presentation.js';
import { computeBracketGeometry, ROW_HEIGHT as FULL_ROW_HEIGHT } from './bracket-geometry.js';
import { esc } from './layout.js';

/**
 * A small bracket for the semi-prestasi compact sheet's pool cards (AUD-012). It draws from exactly
 * the same persisted feeder graph as the full-size renderer — the y-layout comes straight from
 * `computeBracketGeometry` (bracket-geometry.ts, used as-is and only rescaled), so who feeds whom is
 * read from `ExportMatch.feederA/B`, never inferred or recomputed. Only the styling differs: a
 * tight row pitch, slot number + clipped name on the left (the full name lives in the card's table
 * right beside it), and the printed match code on every match.
 *
 * Handles brackets up to `COMPACT_BRACKET_MAX_SIZE` slots; anything larger is left to the tiled
 * full-size bracket sheet (bracket-tiling.ts) — callers check `compactBracketFits`.
 */
export const COMPACT_BRACKET_MAX_SIZE = 32;

const ROW = 11.5;
const SCALE = ROW / FULL_ROW_HEIGHT;
const FONT = 'Segoe UI, Arial, sans-serif';
const FINAL_STUB = 44;
const MAX_COL_WIDTH = 84;
const MIN_LEAF_WIDTH = 60;

export interface CompactBracketOptions {
  /** SVG user-space width; the element is scaled to 100% of its container, so this is ~ the container's width in CSS px. */
  readonly width: number;
  /** Width reserved for the slot number + name column. */
  readonly leafWidth: number;
  /** Clip length (characters) for participant names in the bracket; the full name is in the table. */
  readonly nameChars: number;
}

export function compactBracketFits(bracket: ExportBracket): boolean {
  return bracket.size <= COMPACT_BRACKET_MAX_SIZE && bracket.matches.length > 0;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;

function textEl(
  x: number,
  y: number,
  text: string,
  opts: { size?: number; bold?: boolean; italic?: boolean; fill?: string; anchor?: 'start' | 'end' } = {},
): string {
  const parts = [
    `x="${x}"`,
    `y="${y}"`,
    `font-size="${opts.size ?? 8}"`,
    `font-family="${FONT}"`,
    `fill="${opts.fill ?? '#111'}"`,
  ];
  if (opts.bold) parts.push('font-weight="700"');
  if (opts.italic) parts.push('font-style="italic"');
  if (opts.anchor) parts.push(`text-anchor="${opts.anchor}"`);
  return `<text ${parts.join(' ')}>${esc(text)}</text>`;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Returns an inline `<svg>` for the bracket, or `null` when there is nothing to draw (no matches). */
export function renderCompactBracketSvg(bracket: ExportBracket, opts: CompactBracketOptions): string | null {
  if (!compactBracketFits(bracket)) return null;
  const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
  if (geometry.matches.length === 0) return null;

  const finalRound = bracket.rounds;
  const columns = geometry.matches.reduce((max, n) => Math.max(max, n.column), 1);
  const leafWidth = Math.max(MIN_LEAF_WIDTH, opts.leafWidth);
  const colWidth = Math.min(MAX_COL_WIDTH, (opts.width - leafWidth - FINAL_STUB) / columns);
  const width = leafWidth + columns * colWidth + FINAL_STUB;
  const top = 2;
  const yOf = (rawY: number): number => top + rawY * SCALE + ROW / 2;
  const xOf = (column: number): number => leafWidth + column * colWidth;
  const height = top + Math.max(geometry.leaves.length, 1) * ROW + 3;

  // Which side of the outgoing line a match's code sits on: the side facing AWAY from its sibling, so
  // the parent's vertical connector never runs through the label.
  const codeSide = new Map<string, 'above' | 'below'>();
  for (const n of geometry.matches) {
    for (const [feeder, ownY, otherY] of [
      [n.match.feederA, n.feederAY, n.feederBY],
      [n.match.feederB, n.feederBY, n.feederAY],
    ] as const) {
      if (feeder.kind === 'match') codeSide.set(feeder.matchUid, ownY <= otherY ? 'above' : 'below');
    }
  }

  const parts: string[] = [];

  for (const leaf of geometry.leaves) {
    const y = yOf(leaf.y);
    const slotNo = leaf.key.startsWith('slot:') ? Number(leaf.key.slice('slot:'.length)) + 1 : null;
    parts.push(
      `<line x1="0" y1="${num(y)}" x2="${num(leafWidth)}" y2="${num(y)}" stroke="#aaa" stroke-width="0.6"/>`,
    );
    if (slotNo !== null) parts.push(textEl(0, y - 2, String(slotNo), { size: 7, bold: true, fill: '#666' }));
    const labelX = slotNo !== null ? 11 : 0;
    if (leaf.isBye) {
      parts.push(textEl(labelX, y - 2, SEMI_PRESTASI_COMPACT_LABEL.bye, { italic: true, fill: '#777' }));
    } else {
      parts.push(textEl(labelX, y - 2, clip(leaf.label, opts.nameChars)));
    }
  }

  for (const node of geometry.matches) {
    const x = xOf(node.column);
    const prevX = xOf(node.column - 1);
    const midX = prevX + (x - prevX) / 2;
    const y = yOf(node.y);
    const ay = yOf(node.feederAY);
    const by = yOf(node.feederBY);
    const isFinal = node.match.round === finalRound;
    const stroke = isFinal ? '#111' : '#666';
    const strokeWidth = isFinal ? 1.3 : 0.8;

    parts.push(
      `<path d="M ${num(prevX)} ${num(ay)} H ${num(midX)} V ${num(by)} M ${num(prevX)} ${num(by)} H ${num(midX)} M ${num(midX)} ${num(y)} H ${num(x)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );
    if (isFinal) {
      parts.push(
        `<line x1="${num(x)}" y1="${num(y)}" x2="${num(x + FINAL_STUB - 4)}" y2="${num(y)}" stroke="#111" stroke-width="1.3"/>`,
      );
    }

    const code = clip(node.match.publicCode ?? node.match.matchUid, 14);
    const below = !isFinal && codeSide.get(node.match.matchUid) === 'below';
    const labelY = below ? y + 8 : y - 2.5;
    const status = node.match.status !== 'PENDING' ? ` · ${matchStatusLabel(node.match.status)}` : '';
    parts.push(textEl(x + 3, labelY, `${code}${status}`, { size: 7, bold: isFinal, fill: '#222' }));
    if (isFinal) {
      parts.push(
        textEl(x + 3, y + 8, SEMI_PRESTASI_COMPACT_LABEL.final, { size: 6.5, bold: true, fill: '#a33' }),
      );
    }
  }

  // Always 100% of the container's width (visual polish pass) -- a small bracket (few rounds) used
  // to render at a fraction of its available space instead of filling it, since its natural geometry
  // is narrower than `opts.width`. The viewBox preserves the aspect ratio, so the whole diagram (text,
  // connectors, spacing) scales up together rather than distorting -- it is simply bigger, using the
  // blank space that would otherwise sit unused beside it.
  return `<svg viewBox="0 0 ${num(width)} ${num(height)}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg" role="img">${parts.join('')}</svg>`;
}
