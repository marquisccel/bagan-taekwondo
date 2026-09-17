import type { Quality } from '../lib/api';

/**
 * GREEN/YELLOW/RED always carries text, not just color (ACCEPTANCE §ACCESSIBILITY) — the color
 * itself is never computed here, only displayed; the backend decides the level (see
 * apps/api/src/revision/revision-read.controller.ts).
 */
const LABEL: Record<Quality, string> = { GREEN: 'OK', YELLOW: 'Warning', RED: 'Blocked' };
const ICON: Record<Quality, string> = { GREEN: '✓', YELLOW: '⚠', RED: '✕' };

export function StatusBadge({ quality, title }: { quality: Quality; title?: string }) {
  return (
    <span className={`badge badge-${quality.toLowerCase()}`} title={title}>
      <span aria-hidden="true">{ICON[quality]}</span> {LABEL[quality]}
    </span>
  );
}
