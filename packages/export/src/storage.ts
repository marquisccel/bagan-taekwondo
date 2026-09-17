import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The only artifact-storage abstraction Phase 6 introduces (ACCEPTANCE §12). `storageKey` is
 * opaque metadata chosen by the writer (apps/worker) — never an identity field, never interpreted
 * by domain/export logic. A future object-storage implementation only needs to satisfy this same
 * three-method interface; nothing outside this file may assume a filesystem.
 */
export interface ArtifactStorage {
  write(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (key.length === 0 || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new Error(`unsafe artifact storage key: ${key}`);
  }
}

/** Development/local implementation: one file per key, rooted under `baseDir`. */
export function localArtifactStorage(baseDir: string): ArtifactStorage {
  const resolve = (key: string): string => {
    assertSafeKey(key);
    return join(baseDir, key);
  };
  return {
    async write(key, bytes) {
      const path = resolve(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async read(key) {
      return await readFile(resolve(key));
    },
    async exists(key) {
      try {
        await stat(resolve(key));
        return true;
      } catch {
        return false;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
