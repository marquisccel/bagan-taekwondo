import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id, nowTs, tstz } from './columns.js';
import {
  exportFormatEnum,
  exportModeEnum,
  exportScopeTypeEnum,
  exportStatusEnum,
  exportTypeEnum,
} from './enums.js';
import { appUser, tournament } from './identity.js';
import { category, drawRevision, drawRun, pool } from './draw.js';

/**
 * Phase 6: one row per requested official output, referencing exactly one immutable revision —
 * never "whatever is current" (ACCEPTANCE §EXPORT SOURCE OF TRUTH). The export layer renders this
 * row's already-persisted pools/brackets/matches; it never recomputes them.
 */
export const exportArtifact = pgTable(
  'export_artifact',
  {
    id: id(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    drawRunId: uuid('draw_run_id')
      .notNull()
      .references(() => drawRun.id),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => drawRevision.id),
    revisionNo: integer('revision_no').notNull(),
    exportType: exportTypeEnum('export_type').notNull(),
    format: exportFormatEnum('format').notNull(),
    mode: exportModeEnum('mode').notNull(),
    /** What this one artifact covers: the whole revision, or one category/pool within it. */
    scopeType: exportScopeTypeEnum('scope_type').notNull(),
    categoryId: uuid('category_id').references(() => category.id),
    poolId: uuid('pool_id').references(() => pool.id),
    status: exportStatusEnum('status').notNull().default('REQUESTED'),
    /**
     * Four distinct fingerprints (packages/export/src/fingerprint.ts), never one vague hash:
     *  - sourceFingerprint: identifies the canonical persisted revision content this export reads
     *    (revision content_fingerprint + scope). Set at request time.
     *  - parametersFingerprint: identifies the normalized export request itself (export type,
     *    format, mode, locale, template version). Set at request time.
     *  - outputFingerprint: the semantic export fingerprint — deterministic logical content of the
     *    rendered document, excluding wall-clock/path/random-id noise. Set once rendering succeeds.
     *  - fileSha256: hash of the final binary file bytes. Set once rendering succeeds; may differ
     *    between two runs with an identical outputFingerprint because PDF binary metadata
     *    (producer/creation-date fields written by the renderer) is not semantic content.
     */
    sourceFingerprint: text('source_fingerprint').notNull(),
    parametersFingerprint: text('parameters_fingerprint').notNull(),
    outputFingerprint: text('output_fingerprint'),
    fileSha256: text('file_sha256'),
    engineVersion: text('engine_version').notNull(),
    templateVersion: text('template_version').notNull(),
    storageKey: text('storage_key'),
    filename: text('filename'),
    sizeBytes: integer('size_bytes'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => appUser.id),
    requestedAt: nowTs('requested_at'),
    startedAt: tstz('started_at'),
    generatedAt: tstz('generated_at'),
  },
  (t) => [
    uniqueIndex('export_artifact_public_id_uq').on(t.id),
    check(
      'export_artifact_scope_ck',
      sql`(${t.scopeType} = 'REVISION' and ${t.categoryId} is null and ${t.poolId} is null)
      or (${t.scopeType} = 'CATEGORY' and ${t.categoryId} is not null and ${t.poolId} is null)
      or (${t.scopeType} = 'POOL' and ${t.categoryId} is null and ${t.poolId} is not null)`,
    ),
    check(
      'export_artifact_ready_ck',
      sql`${t.status} <> 'READY' or (${t.storageKey} is not null and ${t.filename} is not null and ${t.sizeBytes} is not null and ${t.outputFingerprint} is not null and ${t.fileSha256} is not null and ${t.generatedAt} is not null)`,
    ),
    check('export_artifact_failed_ck', sql`${t.status} <> 'FAILED' or ${t.errorCode} is not null`),
    check('export_artifact_size_ck', sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
  ],
);
