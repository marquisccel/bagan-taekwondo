import { ENGINE_VERSION } from '@bagantkd/draw-engine';

/**
 * Worker skeleton. Queues (pg-boss, ADR-0002) and their consumers arrive in Phase 4:
 *   draw    — runs the engine twice (dual-run check) and persists the DrawRun
 *   import  — parses, normalizes and validates an ImportBatch
 *   export  — renders PDF/XLSX with Playwright
 */
export const WORKER_QUEUES = ['draw', 'import', 'export'] as const;

process.stdout.write(
  `bagantkd worker skeleton (engine ${ENGINE_VERSION}); queues ${WORKER_QUEUES.join(', ')} are implemented in Phase 4.\n`,
);
