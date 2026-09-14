import {
  executeDrawRun,
  failStuckDrawRun,
  findStaleQueuedRuns,
  findStuckRunningDrawRuns,
  type Db,
} from '@bagantkd/db';

/**
 * Self-healing sweep (ADR-0002): pg-boss delivery is treated as an at-least-once wake signal, not
 * the sole correctness mechanism. `claimQueuedDrawRun`'s atomic `UPDATE ... WHERE status='QUEUED'`
 * is the true serialization point, so re-running `executeDrawRun` for a QUEUED row whose enqueue
 * message was lost (or whose worker crashed before claiming) is always safe. A RUNNING row whose
 * worker crashed mid-execution can never revert to QUEUED (draw_run_guard forbids it) and its
 * transaction never committed, so nothing partial was persisted — the only safe closure is FAILED.
 */
export interface ReconcileResult {
  readonly requeued: readonly string[];
  readonly failed: readonly string[];
}

export async function reconcileOnce(
  db: Db,
  staleMs: number,
  log: Pick<Console, 'warn' | 'error'> = console,
): Promise<ReconcileResult> {
  const requeued: string[] = [];
  const failed: string[] = [];

  for (const id of await findStaleQueuedRuns(db, staleMs)) {
    try {
      const result = await executeDrawRun(db, id);
      if (result.claimed) requeued.push(id);
    } catch (e: unknown) {
      log.error(`reconcile: draw_run ${id} failed on requeue: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const id of await findStuckRunningDrawRuns(db, staleMs)) {
    try {
      if (await failStuckDrawRun(db, id, 'reconciliation sweep: no progress past stale threshold'))
        failed.push(id);
    } catch (e: unknown) {
      log.error(
        `reconcile: draw_run ${id} could not be closed out: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (requeued.length || failed.length)
    log.warn(`reconcile: requeued ${requeued.length}, failed ${failed.length}`);
  return { requeued, failed };
}
