import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tstz } from './columns.js';
import { provenanceSourceEnum, resolutionStatusEnum, transformationOutcomeEnum } from './enums.js';
import { appUser, tournament } from './identity.js';
import { importBatch, importRow } from './participants.js';
import { ruleSet } from './rules.js';

const FINGERPRINT_RE = `'^sha256:[0-9a-f]{64}$'`;

/**
 * RAW → NORMALIZED → RESOLVED (instruction 1). One row per field whose value was normalized, is
 * invalid, or carries a suggestion. The raw value is never overwritten; the resolution (who, why,
 * when, which value) is recorded exactly once (trigger field_transformation_guard).
 */
export const fieldTransformation = pgTable(
  'field_transformation',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatch.id),
    importRowId: uuid('import_row_id')
      .notNull()
      .references(() => importRow.id),
    field: text('field').notNull(),
    rawValue: text('raw_value').notNull(),
    normalizedValue: text('normalized_value'),
    outcome: transformationOutcomeEnum('outcome').notNull(),
    ruleCode: text('rule_code').notNull(),
    ruleProvenance: provenanceSourceEnum('rule_provenance').notNull(),
    suggestion: jsonb('suggestion'),
    resolutionStatus: resolutionStatusEnum('resolution_status').notNull().default('UNRESOLVED'),
    resolvedValue: text('resolved_value'),
    resolvedBy: uuid('resolved_by').references(() => appUser.id),
    resolvedAt: tstz('resolved_at'),
    resolutionReason: text('resolution_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('field_transformation_row_field_uq').on(t.importRowId, t.field),
    index('field_transformation_batch_ix').on(t.batchId, t.resolutionStatus),
    check(
      'field_transformation_resolution_ck',
      sql`(${t.resolutionStatus} = 'UNRESOLVED') = (${t.resolvedBy} is null)
        and (${t.resolvedBy} is null) = (${t.resolvedAt} is null)
        and (${t.resolvedBy} is null) = (${t.resolutionReason} is null)`,
    ),
    check(
      'field_transformation_reason_ck',
      sql`${t.resolutionReason} is null or char_length(btrim(${t.resolutionReason})) >= 15`,
    ),
    check(
      'field_transformation_resolved_value_ck',
      sql`(${t.resolutionStatus} in ('ACCEPTED', 'CORRECTED')) = (${t.resolvedValue} is not null)`,
    ),
    check(
      'field_transformation_normalized_ck',
      sql`(${t.outcome} = 'INVALID') = (${t.normalizedValue} is null)`,
    ),
  ],
);

/**
 * The immutable input of a draw (instruction 5): exactly the entries the engine sees, derived from
 * one COMMITTED import batch under one rule set. Append-only (trigger); a re-import is a new batch
 * and a new snapshot, so draw runs bound to an older snapshot never change.
 */
export const intakeSnapshot = pgTable(
  'intake_snapshot',
  {
    id: id(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    batchId: uuid('batch_id').notNull(),
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => ruleSet.id),
    adapter: text('adapter').notNull(),
    schemaVersion: smallint('schema_version').notNull(),
    ruleSetFingerprint: text('rule_set_fingerprint').notNull(),
    fingerprint: text('fingerprint').notNull(),
    entryCount: integer('entry_count').notNull(),
    content: jsonb('content').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('intake_snapshot_id_tournament_uq').on(t.id, t.tournamentId),
    unique('intake_snapshot_batch_rules_uq').on(t.batchId, t.ruleSetFingerprint),
    foreignKey({
      columns: [t.batchId, t.tournamentId],
      foreignColumns: [importBatch.id, importBatch.tournamentId],
    }),
    check(
      'intake_snapshot_fingerprints_ck',
      sql`${t.fingerprint} ~ ${sql.raw(FINGERPRINT_RE)} and ${t.ruleSetFingerprint} ~ ${sql.raw(FINGERPRINT_RE)}`,
    ),
    check('intake_snapshot_entries_ck', sql`${t.entryCount} >= 0`),
  ],
);
