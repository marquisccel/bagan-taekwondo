import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tstz } from './columns.js';
import { actorKindEnum, commandOutcomeEnum, complaintStatusEnum, subjectTypeEnum } from './enums.js';
import { drawRevision } from './draw.js';
import { appUser, tournament } from './identity.js';
import { contingent } from './participants.js';

/** Append-only log of every command attempt against a revision, applied or rejected. */
export const drawCommand = pgTable(
  'draw_command',
  {
    id: id(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    baseRevisionId: uuid('base_revision_id')
      .notNull()
      .references(() => drawRevision.id),
    resultingRevisionId: uuid('resulting_revision_id').references(() => drawRevision.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    expectedLockVersion: integer('expected_lock_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => appUser.id),
    reason: text('reason'),
    complaintId: uuid('complaint_id').references((): AnyPgColumn => complaint.id),
    outcome: commandOutcomeEnum('outcome').notNull(),
    rejectionCode: text('rejection_code'),
    verdict: jsonb('verdict').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('draw_command_idempotency_uq').on(t.tournamentId, t.idempotencyKey),
    check('draw_command_rejection_ck', sql`(${t.outcome} = 'REJECTED') = (${t.rejectionCode} is not null)`),
    check('draw_command_result_ck', sql`${t.outcome} = 'APPLIED' or ${t.resultingRevisionId} is null`),
    check('draw_command_idempotency_ck', sql`char_length(${t.idempotencyKey}) between 8 and 128`),
  ],
);

/**
 * Tamper-evident audit trail (ADR-0013). Rows are append-only (trigger audit_event_append_only).
 * Each event carries the hash of its predecessor in the same chain; the insert trigger rejects
 * any event whose prev_hash is not the current chain head, so the chain cannot fork. Hashes are
 * SHA-256 over the canonical JSON of the event, computed by the application and verified by
 * the INV-07 checker.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    id: uuid('id').notNull().unique().defaultRandom(),
    chainKey: text('chain_key').notNull(),
    tournamentId: uuid('tournament_id').references(() => tournament.id),
    occurredAt: tstz('occurred_at').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: uuid('actor_id').references(() => appUser.id),
    action: text('action').notNull(),
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    complaintId: uuid('complaint_id'),
    commandId: uuid('command_id'),
    correlationId: text('correlation_id'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_event_chain_ix').on(t.chainKey, t.seq),
    index('audit_event_subject_ix').on(t.subjectType, t.subjectId),
    check('audit_event_actor_ck', sql`(${t.actorKind} = 'USER') = (${t.actorId} is not null)`),
    check(
      'audit_event_hash_ck',
      sql`${t.hash} ~ '^sha256:[0-9a-f]{64}$' and (${t.prevHash} is null or ${t.prevHash} ~ '^sha256:[0-9a-f]{64}$')`,
    ),
    check(
      'audit_event_chain_key_ck',
      sql`(${t.tournamentId} is null and ${t.chainKey} = 'global') or (${t.tournamentId} is not null and ${t.chainKey} = 'tournament:' || ${t.tournamentId}::text)`,
    ),
  ],
);

/** Current head of each audit chain; maintained only by the audit_event insert trigger. */
export const auditChainHead = pgTable('audit_chain_head', {
  chainKey: text('chain_key').primaryKey(),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
  lastHash: text('last_hash').notNull(),
});

export const complaint = pgTable(
  'complaint',
  {
    id: id(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    filedByUserId: uuid('filed_by_user_id').references(() => appUser.id),
    filedByName: text('filed_by_name').notNull(),
    contingentId: uuid('contingent_id').references(() => contingent.id),
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    reason: text('reason').notNull(),
    status: complaintStatusEnum('status').notNull().default('OPEN'),
    decision: text('decision'),
    decidedBy: uuid('decided_by').references(() => appUser.id),
    decidedAt: tstz('decided_at'),
    resultingCommandId: uuid('resulting_command_id').references((): AnyPgColumn => drawCommand.id),
    resultingRevisionId: uuid('resulting_revision_id').references(() => drawRevision.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'complaint_decision_ck',
      sql`${t.status} in ('OPEN', 'UNDER_REVIEW') or (char_length(btrim(coalesce(${t.decision}, ''))) > 0 and ${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    check(
      'complaint_resolution_ref_ck',
      sql`${t.status} not in ('ACCEPTED', 'RESOLVED') or ${t.resultingCommandId} is not null or ${t.resultingRevisionId} is not null`,
    ),
  ],
);
