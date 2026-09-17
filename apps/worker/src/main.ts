import { executeDrawRun, poolDb } from '@bagantkd/db';
import { ENGINE_VERSION } from '@bagantkd/draw-engine';
import { localArtifactStorage } from '@bagantkd/export';
import pg from 'pg';
import { PgBoss, type Job } from 'pg-boss';

import { EXPORT_QUEUE, registerExportWorker } from './export-worker.js';
import { reconcileOnce } from './reconcile.js';

/**
 * Worker (Phase 4). Two independent mechanisms keep DrawRun execution correct even across crashes
 * (ADR-0002): the pg-boss `draw-run` queue is an at-least-once wake signal, and a periodic
 * reconciliation sweep self-heals anything the queue lost (lost enqueue message, crashed worker).
 * `executeDrawRun`'s own `claimQueuedDrawRun` CAS is the single source of truth for "who runs it,
 * exactly once" — both paths call the same function and are safe to race.
 */
export const DRAW_RUN_QUEUE = 'draw-run';

export interface WorkerHandle {
  stop(): Promise<void>;
}

export async function startWorker(options: {
  connectionString: string;
  reconcileIntervalMs?: number;
  staleMs?: number;
  /** Local filesystem root for generated export artifacts (Phase 6). */
  exportStorageDir?: string;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Promise<WorkerHandle> {
  const log = options.log ?? console;
  const reconcileIntervalMs = options.reconcileIntervalMs ?? 30_000;
  const staleMs = options.staleMs ?? 5 * 60_000;
  const exportStorage = localArtifactStorage(options.exportStorageDir ?? 'var/exports');

  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5 });
  pool.on('error', (err: Error) => {
    log.warn(`postgres idle client error: ${err.message}`);
  });
  const db = poolDb(pool);

  const boss = new PgBoss(options.connectionString);
  boss.on('error', (err: Error) => {
    log.error(`pg-boss error: ${err.message}`);
  });
  await boss.start();
  await boss.createQueue(DRAW_RUN_QUEUE);
  await boss.createQueue(EXPORT_QUEUE);

  await boss.work<{ drawRunId: string }>(
    DRAW_RUN_QUEUE,
    { batchSize: 1 },
    async (jobs: Job<{ drawRunId: string }>[]) => {
      const job = jobs[0];
      if (!job) return;
      const { drawRunId } = job.data;
      const result = await executeDrawRun(db, drawRunId);
      log.log(
        `draw_run ${drawRunId}: ${result.claimed ? `executed (${result.output?.status})` : 'already claimed, skipped'}`,
      );
    },
  );

  await registerExportWorker(boss, db, exportStorage, log);

  const timer = setInterval(() => {
    reconcileOnce(db, exportStorage, staleMs, log).catch((e: unknown) => {
      log.error(`reconcile sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, reconcileIntervalMs);
  timer.unref();

  log.log(
    `bagantkd worker started (engine ${ENGINE_VERSION}); queues "${DRAW_RUN_QUEUE}", "${EXPORT_QUEUE}", reconcile every ${reconcileIntervalMs}ms, stale threshold ${staleMs}ms`,
  );

  return {
    async stop() {
      clearInterval(timer);
      await boss.stop({ graceful: true });
      await pool.end();
    },
  };
}

/* c8 ignore start */
if (process.env['BAGANTKD_WORKER_MAIN'] !== 'skip') {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const handle = await startWorker({
    connectionString,
    ...(process.env['EXPORT_STORAGE_DIR'] ? { exportStorageDir: process.env['EXPORT_STORAGE_DIR'] } : {}),
  });
  const shutdown = (signal: string) => {
    process.stdout.write(`received ${signal}, shutting down\n`);
    handle
      .stop()
      .then(() => process.exit(0))
      .catch((e: unknown) => {
        process.stderr.write(`shutdown error: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}
/* c8 ignore stop */
