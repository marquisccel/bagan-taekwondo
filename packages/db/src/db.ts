import type { SqlExecutor } from './intake-repository.js';

/**
 * The database handle production code depends on: parameterized queries plus transactions.
 * `TestDb` (testing/test-db.ts) adds a backend label and `close()` for the test harness; a real
 * deployment implements this same shape over a `pg.Pool` (see `apps/worker`, `apps/api`).
 */
export interface Db extends SqlExecutor {
  /** Runs `fn` in one transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** A `pg.Pool`-backed `Db`, for apps/api and apps/worker. */
export function poolDb(pool: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
}): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      return (await pool.query(text, params as unknown[])).rows as T[];
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          async query<R>(text: string, params: readonly unknown[] = []) {
            return (await client.query(text, params as unknown[])).rows as R[];
          },
        });
        await client.query('commit');
        return out;
      } catch (e: unknown) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
