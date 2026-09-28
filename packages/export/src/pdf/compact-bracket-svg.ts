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

const COMPACT_ROW = 11.5;
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
  /**
   * FINAL/OFFICIAL presentation (Official Bracket Presentation): no participant table sits beside the
   * bracket, so each leaf carries the participant name and, beneath it, the contingent, and every
   * match is labelled with a plain sequential number instead of its internal code. Presentation
   * only -- nothing persisted changes.
   */
  readonly integrated?: boolean;
  /** Document-level display numbers (see `documentMatchNumbers`); absent = numbered from 1 within this bracket. */
  readonly matchNumbers?: ReadonlyMap<string, number>;
  /**
   * FINAL/OFFICIAL only: the id/gender/division/weight-class columns shown beside the name on every
   * leaf row (structural reference: the legacy manually-produced bracket sheet). Gender, division and
   * weight class are the same for every entry of one category, so they are given once here rather than
   * threaded through the geometry; `idByEntryId` looks up each entry's own external registration id
   * (`ExportEntry.externalRef`) by `GeometryLeaf.entryId`. Omitted -> the leaf falls back to the
   * plain name/contingent layout (used by direct callers/tests that don't need the extra columns).
   */
  readonly columns?: {
    readonly genderLabel: string;
    readonly divisionLabel: string;
    readonly weightClassLabel: string;
    readonly idByEntryId: ReadonlyMap<string, string>;
  };
}

const INTEGRATED_STROKE = '#222';
const INTEGRATED_STROKE_WIDTH = 1.1;
const INTEGRATED_ROW = 40;
const INTEGRATED_NAME_CHARS = 46;
const INTEGRATED_CONTINGENT_CHARS = 72;

/** Single-row leaf layout (structural reference: the legacy manually-produced bracket sheet) — one
 * line per participant: id, name, gender, division, weight class, contingent, left to right. Used
 * whenever `CompactBracketOptions.columns` is given; a shorter row pitch than the 2-line fallback
 * since there is no wrapped second line. Column x-offsets/char budgets are fixed proportions of
 * `INTEGRATED_COLUMNS_LEAF_WIDTH` (see `OFFICIAL_BRACKET_AREA` in semi-prestasi-compact.ts). */
const INTEGRATED_ROW_COLUMNS = 24;
const LEAF_COLUMNS = [
  { key: 'id', x: 2, chars: 7 },
  { key: 'name', x: 50, chars: 42, bold: true },
  { key: 'gender', x: 320, chars: 11 },
  { key: 'division', x: 404, chars: 18 },
  { key: 'weightClass', x: 542, chars: 7 },
  { key: 'contingent', x: 592, chars: 24 },
] as const;

/**
 * Presentation-only match numbers, in competition order: round ascending, then position ascending
 * within the round (the geometry's own order). Numbers start at `start` and are contiguous over the
 * nodes given -- pass only DRAWN matches (a collapsed WALKOVER is not a node, so it takes no number).
 * Deterministic: derived only from the persisted round/position, never from a code, uid or run order;
 * the persisted match code/uid are untouched.
 */
export function presentationMatchNumbers(
  nodes: readonly {
    readonly match: { readonly matchUid: string; readonly round: number; readonly position: number };
  }[],
  start = 1,
): Map<string, number> {
  const ordered = [...nodes].sort(
    (a, b) => a.match.round - b.match.round || a.match.position - b.match.position,
  );
  return new Map(ordered.map((n, i) => [n.match.matchUid, start + i]));
}

/**
 * Document-level numbering for FINAL/OFFICIAL: ONE contiguous sequence 1, 2, 3, ... across every
 * bracket of the document, in the order the brackets are given (the document's own deterministic
 * category/pool order). Brackets that are not drawn (missing, no matches, too large for the card)
 * take no numbers.
 */
export function documentMatchNumbers(
  brackets: readonly (ExportBracket | null | undefined)[],
): Map<string, number> {
  const all = new Map<string, number>();
  let next = 1;
  for (const bracket of brackets) {
    if (!bracket || !compactBracketFits(bracket)) continue;
    const drawn = computeBracketGeometry(bracket.matches, bracket.slots).matches;
    for (const [uid, n] of presentationMatchNumbers(drawn, next)) all.set(uid, n);
    next += drawn.length;
  }
  return all;
}

/** Greedy word wrap into at most two lines; the second is clipped, a single over-long word is clipped. */
function wrapTwoLines(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let i = 0;
  while (i < words.length) {
    const next = first ? `${first} ${words[i]}` : (words[i] as string);
    if (next.length > max) break;
    first = next;
    i += 1;
  }
  if (first === '') return [clip(text, max)];
  return [first, clip(words.slice(i).join(' '), max)];
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

  const integrated = opts.integrated === true;
  const leafColumns = integrated ? opts.columns : undefined;
  const ROW = integrated ? (leafColumns ? INTEGRATED_ROW_COLUMNS : INTEGRATED_ROW) : COMPACT_ROW;
  const SCALE = ROW / FULL_ROW_HEIGHT;
  const matchNumber = opts.matchNumbers ?? presentationMatchNumbers(geometry.matches);
  const finalRound = bracket.rounds;
  const numColumns = geometry.matches.reduce((max, n) => Math.max(max, n.column), 1);
  const leafWidth = Math.max(MIN_LEAF_WIDTH, opts.leafWidth);
  // Integrated (FINAL) brackets always span the whole width, so every pool reads at one scale.
  const colWidth = integrated
    ? (opts.width - leafWidth - FINAL_STUB) / numColumns
    : Math.min(MAX_COL_WIDTH, (opts.width - leafWidth - FINAL_STUB) / numColumns);
  const width = leafWidth + numColumns * colWidth + FINAL_STUB;
  const top = integrated ? 18 : 2;
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
  const leafYs = new Set(geometry.leaves.map((l) => l.y));

  for (const leaf of geometry.leaves) {
    const y = yOf(leaf.y);
    const slotNo =
      !integrated && leaf.key.startsWith('slot:') ? Number(leaf.key.slice('slot:'.length)) + 1 : null;
    parts.push(
      `<line x1="0" y1="${num(y)}" x2="${num(leafWidth)}" y2="${num(y)}" stroke="${integrated ? INTEGRATED_STROKE : '#aaa'}" stroke-width="${integrated ? INTEGRATED_STROKE_WIDTH : 0.6}"/>`,
    );
    if (integrated) {
      if (leaf.isBye) {
        parts.push(textEl(2, y - 3, SEMI_PRESTASI_COMPACT_LABEL.bye, { italic: true, fill: '#777' }));
        continue;
      }
      if (leafColumns) {
        const id = (leaf.entryId && leafColumns.idByEntryId.get(leaf.entryId)) || '';
        const values: Record<(typeof LEAF_COLUMNS)[number]['key'], string> = {
          id,
          name: leaf.label,
          gender: leafColumns.genderLabel,
          division: leafColumns.divisionLabel,
          weightClass: leafColumns.weightClassLabel,
          contingent: leaf.sublabel ?? '',
        };
        for (const col of LEAF_COLUMNS) {
          const text = clip(values[col.key], col.chars);
          const bold: boolean = 'bold' in col && col.bold;
          if (text) parts.push(textEl(col.x, y - 3, text, { size: 9, bold }));
        }
        continue;
      }
      const hasContingent = leaf.sublabel !== null && leaf.sublabel !== '';
      const nameLines = wrapTwoLines(leaf.label, INTEGRATED_NAME_CHARS);
      const nameBase = y - (hasContingent ? 15 : 4);
      nameLines.forEach((line, idx) => {
        parts.push(textEl(2, nameBase - (nameLines.length - 1 - idx) * 12.5, line, { size: 12, bold: true }));
      });
      if (hasContingent)
        parts.push(
          textEl(2, y - 4, clip(leaf.sublabel, INTEGRATED_CONTINGENT_CHARS), {
            size: 9,
            fill: '#444',
          }),
        );
      continue;
    }
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
    if (node.column > 1) {
      // A participant who advanced without a drawn match (a collapsed walkover) still sits at the
      // leaf column: run its line across to this match so it visibly feeds it.
      for (const rawY of [node.feederAY, node.feederBY])
        if (leafYs.has(rawY))
          parts.push(
            `<line x1="${num(leafWidth)}" y1="${num(yOf(rawY))}" x2="${num(prevX)}" y2="${num(yOf(rawY))}" stroke="${integrated ? INTEGRATED_STROKE : '#666'}" stroke-width="${integrated ? INTEGRATED_STROKE_WIDTH : 0.8}"/>`,
          );
    }
    // FINAL: one uniform line weight end to end, so a winner's line never changes look between rounds.
    const stroke = integrated ? INTEGRATED_STROKE : isFinal ? '#111' : '#666';
    const strokeWidth = integrated ? INTEGRATED_STROKE_WIDTH : isFinal ? 1.3 : 0.8;

    parts.push(
      `<path d="M ${num(prevX)} ${num(ay)} H ${num(midX)} V ${num(by)} M ${num(prevX)} ${num(by)} H ${num(midX)} M ${num(midX)} ${num(y)} H ${num(x)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
    );
    if (isFinal) {
      parts.push(
        // FINAL/OFFICIAL: the stub runs all the way to the SVG's own right edge (no "-4" trim) so it
        // lines up with the page-number footer, which is inset to the same body-content right margin.
        `<line x1="${num(x)}" y1="${num(y)}" x2="${num(x + FINAL_STUB - (integrated ? 0 : 4))}" y2="${num(y)}" stroke="${integrated ? INTEGRATED_STROKE : '#111'}" stroke-width="${integrated ? INTEGRATED_STROKE_WIDTH : 1.3}"/>`,
      );
    }

    const code = integrated
      ? String(matchNumber.get(node.match.matchUid) ?? '')
      : clip(node.match.publicCode ?? node.match.matchUid, 14);
    const below = !isFinal && codeSide.get(node.match.matchUid) === 'below';
    const labelY = below ? y + (integrated ? 13 : 8) : y - 2.5;
    const status =
      !integrated && node.match.status !== 'PENDING' ? ` · ${matchStatusLabel(node.match.status)}` : '';
    parts.push(
      textEl(x + 3, labelY, `${code}${status}`, {
        size: integrated ? 11 : 7,
        bold: isFinal || integrated,
        fill: '#222',
      }),
    );
    if (isFinal && !integrated) {
      // FINAL/OFFICIAL (structural reference: the legacy sheet): pure numbers only, no "FINAL" word.
      parts.push(
        textEl(x + 3, y + (integrated ? 13 : 8), SEMI_PRESTASI_COMPACT_LABEL.final, {
          size: 6.5,
          bold: true,
          fill: '#a33',
        }),
      );
    }
  }

  // Rendered at its own natural size, never stretched to fill the container (visual polish pass,
  // reverting an earlier "always 100% width" change): a 2-person pool's 1-round bracket has a much
  // narrower natural geometry than a 4+-person one's, so stretching both to the same container width
  // blew the 1-round bracket's text, row pitch and line weight up far more -- it no longer looked
  // like the same diagram at a different size, it looked outright oversized. A bracket with fewer
  // rounds now simply occupies less horizontal space (leaving blank room beside it in the row) so
  // that every pool's bracket reads at one consistent visual size.
  if (integrated)
    return `<svg width="100%" viewBox="0 0 ${num(width)} ${num(height)}" style="display:block;height:auto" xmlns="http://www.w3.org/2000/svg" role="img">${parts.join('')}</svg>`;
  return `<svg width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" style="display:block" xmlns="http://www.w3.org/2000/svg" role="img">${parts.join('')}</svg>`;
}
