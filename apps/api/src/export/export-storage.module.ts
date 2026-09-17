import { localArtifactStorage, type ArtifactStorage } from '@bagantkd/export';
import { Global, Module } from '@nestjs/common';

export const EXPORT_STORAGE = Symbol('EXPORT_STORAGE');

/**
 * Filesystem-backed for dev/local (Phase 6 ACCEPTANCE §12) — must point at the SAME directory the
 * worker writes to (apps/worker's `exportStorageDir`, default `var/exports`, both relative to the
 * process's own cwd; set `EXPORT_STORAGE_DIR` to an absolute shared path in any deployment where
 * the API and worker run from different working directories).
 */
@Global()
@Module({
  providers: [
    {
      provide: EXPORT_STORAGE,
      useFactory: (): ArtifactStorage =>
        localArtifactStorage(process.env['EXPORT_STORAGE_DIR'] ?? 'var/exports'),
    },
  ],
  exports: [EXPORT_STORAGE],
})
export class ExportStorageModule {}
