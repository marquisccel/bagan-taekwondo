import type { ExportMode, ExportStatus, RevisionLifecycle } from './enums.js';

/**
 * Phase 6 lock/publish policy: an OFFICIAL export may only be generated from a revision that is
 * already LOCKED, PUBLISHED, or AMENDED (AMENDED is still the official result until its child
 * publishes — see revision-lifecycle.ts's `isOfficial`). PREVIEW is allowed from any state that
 * still has content to render; a SUPERSEDED revision is a dead branch, never exportable.
 */
const OFFICIAL_LIFECYCLES: ReadonlySet<RevisionLifecycle> = new Set(['LOCKED', 'PUBLISHED', 'AMENDED']);
const EXPORTABLE_LIFECYCLES: ReadonlySet<RevisionLifecycle> = new Set([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'LOCKED',
  'PUBLISHED',
  'AMENDED',
]);

export function canExportInMode(lifecycle: RevisionLifecycle, mode: ExportMode): boolean {
  if (mode === 'OFFICIAL') return OFFICIAL_LIFECYCLES.has(lifecycle);
  return EXPORTABLE_LIFECYCLES.has(lifecycle);
}

/** Export generation state machine: REQUESTED -> GENERATING -> {READY, FAILED}. Mirrors draw_run_guard's shape (Phase 4). */
const EXPORT_TRANSITIONS: Readonly<Record<ExportStatus, ReadonlySet<ExportStatus>>> = {
  REQUESTED: new Set(['GENERATING']),
  GENERATING: new Set(['READY', 'FAILED']),
  READY: new Set([]),
  FAILED: new Set([]),
};

export function exportTransitionAllowed(from: ExportStatus, to: ExportStatus): boolean {
  return EXPORT_TRANSITIONS[from].has(to);
}
