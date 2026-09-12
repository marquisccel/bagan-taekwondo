import type { ImportBatchStatus } from './enums.js';

/**
 * Import batch lifecycle (PHASE2_PLAN §8). A batch is created UPLOADED and moves forward one step
 * at a time; COMMITTED and FAILED are final. Once COMMITTED the batch, its rows and its
 * transformations are immutable (only a transformation's one-time resolution may be recorded).
 * Mirrored by the SQL trigger import_batch_guard; a parity test keeps them equal.
 */
export const IMPORT_BATCH_TRANSITIONS: Readonly<Record<ImportBatchStatus, readonly ImportBatchStatus[]>> = {
  UPLOADED: ['PARSED', 'FAILED'],
  PARSED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['COMMITTED', 'FAILED'],
  COMMITTED: [],
  FAILED: [],
};

export function canTransitionImportBatch(from: ImportBatchStatus, to: ImportBatchStatus): boolean {
  return IMPORT_BATCH_TRANSITIONS[from].includes(to);
}
