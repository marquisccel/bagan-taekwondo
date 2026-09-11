import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { HealthController, READINESS_PROBES } from './health/health.controller';
import type { Probe } from './health/readiness';

const PG_POOL = Symbol('PG_POOL');

/**
 * A pg Pool emits 'error' when an idle connection is terminated by the server (database restart,
 * failover, admin kill). Without a listener Node treats it as an unhandled 'error' event and
 * exits the process — found by the Phase 1 smoke test. The pool discards the broken client and
 * reconnects on the next query, so logging is the correct response.
 */
export function createPool(connectionString: string | undefined, logger: Pick<Logger, 'warn'>): Pool {
  const pool = new Pool({ connectionString, max: 5 });
  pool.on('error', (err) => {
    logger.warn(`postgres idle client error: ${err.message}`);
  });
  return pool;
}

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => createPool(process.env['DATABASE_URL'], new Logger('Postgres')),
    },
    {
      provide: READINESS_PROBES,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Probe[] => [
        {
          name: 'postgres',
          check: async () => {
            await pool.query('select 1');
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
