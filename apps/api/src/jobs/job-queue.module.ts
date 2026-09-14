import { Global, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const DRAW_RUN_QUEUE = 'draw-run';

/**
 * Thin wrapper the API uses only to `send()` — execution lives in apps/worker. Per ADR-0002 the
 * enqueue is NOT wrapped in the same transaction as `createDrawRun` (a true transactional pg-boss
 * enqueue is significant added complexity for a low-throughput queue); if this call is lost
 * (crash between the DB commit and here, or pg-boss itself unreachable), the worker's
 * reconciliation sweep picks the row up from `findStaleQueuedRuns` — so a failed `send()` here is
 * logged, never thrown, and never blocks the HTTP response.
 */
export class JobQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('JobQueue');
  private readonly boss: PgBoss;

  constructor(connectionString: string) {
    this.boss = new PgBoss(connectionString);
    this.boss.on('error', (err: Error) => {
      this.logger.warn(`pg-boss error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(DRAW_RUN_QUEUE);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: false });
  }

  async enqueueDrawRun(drawRunId: string): Promise<void> {
    try {
      await this.boss.send(DRAW_RUN_QUEUE, { drawRunId });
    } catch (e: unknown) {
      this.logger.warn(
        `enqueue failed for draw_run ${drawRunId}, reconciliation sweep will pick it up: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [{ provide: JOB_QUEUE, useFactory: () => new JobQueue(process.env['DATABASE_URL'] ?? '') }],
  exports: [JOB_QUEUE],
})
export class JobQueueModule {}
