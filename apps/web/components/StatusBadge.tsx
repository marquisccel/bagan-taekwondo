import type { Quality } from '../lib/api';
import { qualityIcon, qualityLabel } from '../lib/id-labels';

/**
 * GREEN/YELLOW/RED always carries text, not just color (ACCEPTANCE §ACCESSIBILITY) — the color
 * itself is never computed here, only displayed; the backend decides the level (see
 * apps/api/src/revision/revision-read.controller.ts). Icon is static, never animated/pulsing —
 * this is tournament status, not infrastructure monitoring (UX slice 0, §23).
 */
export function StatusBadge({ quality, title }: { quality: Quality; title?: string }) {
  return (
    <span className={`badge badge-${quality.toLowerCase()}`} title={title}>
      <span aria-hidden="true">{qualityIcon[quality]}</span> {qualityLabel(quality)}
    </span>
  );
}
