import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { AuditModule } from './audit/audit.module';
import { DB, DbModule, PG_POOL } from './db/db.module';
import { DrawRunModule } from './draw-run/draw-run.module';
import { HealthController, READINESS_PROBES } from './health/health.controller';
import type { Probe } from './health/readiness';
import { JobQueueModule } from './jobs/job-queue.module';
import { RevisionModule } from './revision/revision.module';

@Module({
  imports: [DbModule, JobQueueModule, DrawRunModule, RevisionModule, AuditModule],
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_PROBES,
      inject: [DB],
      useFactory: (db: { query: (text: string) => Promise<unknown> }): Probe[] => [
        {
          name: 'postgres',
          check: async () => {
            await db.query('select 1');
          },
        },
      ],
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
