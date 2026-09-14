import { poolDb, type Db } from '@bagantkd/db';
import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

/**
 * A pg Pool emits 'error' when an idle connection is terminated by the server (database restart,
 * failover, admin kill). Without a listener Node treats it as an unhandled 'error' event and exits
 * the process — found by the Phase 1 smoke test. The pool discards the broken client and
 * reconnects on the next query, so logging is the correct response.
 */
export function createPool(connectionString: string | undefined, logger: Pick<Logger, 'warn'>): Pool {
  const pool = new Pool({ connectionString, max: 5 });
  pool.on('error', (err) => {
    logger.warn(`postgres idle client error: ${err.message}`);
  });
  return pool;
}

/** Shared across every feature module: one pool, one `Db` handle (packages/db never touches pg directly). */
@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: () => createPool(process.env['DATABASE_URL'], new Logger('Postgres')) },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Db => poolDb(pool) },
  ],
  exports: [PG_POOL, DB],
})
export class DbModule {}
