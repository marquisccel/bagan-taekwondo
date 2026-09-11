import { fileURLToPath } from 'node:url';

export * as schema from './schema/index.js';

/** Absolute path of the SQL migrations folder (drizzle journal format). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
