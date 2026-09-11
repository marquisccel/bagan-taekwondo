import { randomBytes } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { MIGRATIONS_FOLDER } from '../index.js';

/**
 * Minimal raw-SQL handle used by the database tests. Constraint and trigger tests use plain SQL
 * on purpose: they verify what the database itself refuses, independent of any ORM.
 */
export interface TestDb {
  readonly backend: string;
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface Backend {
  readonly name: string;
  open(): Promise<TestDb>;
}

const pgliteBackend: Backend = {
  name: 'pglite',
  async open() {
    const client = new PGlite();
    await migratePglite(drizzlePglite(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const version = (await client.query<{ v: string }>('select version() as v')).rows[0]?.v ?? '';
    return {
      backend: `pglite (${version.split(' ').slice(0, 2).join(' ')})`,
      async query<T>(text: string, params: readonly unknown[] = []) {
        return (await client.query<T>(text, params as unknown[])).rows;
      },
      close: () => client.close(),
    };
  },
};

/** Real PostgreSQL: a throwaway database is created per run and dropped afterwards. */
function postgresBackend(adminUrl: string): Backend {
  return {
    name: 'postgres',
    async open() {
      const dbName = `bagantkd_test_${randomBytes(6).toString('hex')}`;
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`create database ${dbName}`);
      await admin.end();
      const url = new URL(adminUrl);
      url.pathname = `/${dbName}`;
      const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
      await migratePg(drizzlePg(pool), { migrationsFolder: MIGRATIONS_FOLDER });
      const version = (await pool.query<{ v: string }>('select version() as v')).rows[0]?.v ?? '';
      return {
        backend: `postgres (${version.split(' ').slice(0, 2).join(' ')})`,
        async query<T>(text: string, params: readonly unknown[] = []) {
          return (await pool.query(text, params as unknown[])).rows as T[];
        },
        async close() {
          await pool.end();
          const cleanup = new pg.Client({ connectionString: adminUrl });
          await cleanup.connect();
          await cleanup.query(`drop database if exists ${dbName} with (force)`);
          await cleanup.end();
        },
      };
    },
  };
}

/** PGlite always; real PostgreSQL additionally when DATABASE_URL is set (CI uses postgres:16). */
export function testBackends(): Backend[] {
  const url = process.env['DATABASE_URL'];
  return url ? [pgliteBackend, postgresBackend(url)] : [pgliteBackend];
}

/** Resolves to the error's code/message so tests can assert on the database's refusal. */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e: unknown) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
    const message = e instanceof Error ? e.message : String(e);
    return `${code} ${message}`;
  }
  return 'NO_ERROR';
}
