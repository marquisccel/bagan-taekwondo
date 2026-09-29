import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, nowTs, tstz } from './columns.js';
import {
  categoryGenderEnum,
  categoryReadinessEnum,
  disciplineEnum,
  drawRunKindEnum,
  drawRunStatusEnum,
  entryFormatEnum,
  matchStatusEnum,
  poolStrategyEnum,
  revisionLifecycleEnum,
  streamEnum,
} from './enums.js';
import { appUser, tournament } from './identity.js';
import { intakeSnapshot } from './intake.js';
import { entry } from './participants.js';
import { ruleAgeDivision, ruleCategoryTemplate, ruleSet, ruleWeightClass } from './rules.js';

const tournamentRef = () =>
  uuid('tournament_id')
    .notNull()
    .references(() => tournament.id);

const FINGERPRINT_RE = `'^sha256:[0-9a-f]{64}$'`;

export const arena = pgTable(
  'arena',
  { id: id(), tournamentId: tournamentRef(), code: text('code').notNull(), name: text('name').notNull() },
  (t) => [
    unique('arena_code_uq').on(t.tournamentId, t.code),
    check('arena_code_ck', sql`${t.code} ~ '^[A-Z]{1,3}$'`),
  ],
);

export const category = pgTable(
  'category',
  {
    id: id(),
    tournamentId: tournamentRef(),
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => ruleSet.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => ruleCategoryTemplate.id),
    categoryKey: text('category_key').notNull(),
    stream: streamEnum('stream').notNull(),
    discipline: disciplineEnum('discipline').notNull(),
    format: entryFormatEnum('format').notNull(),
    ageDivisionId: uuid('age_division_id')
      .notNull()
      .references(() => ruleAgeDivision.id),
    gender: categoryGenderEnum('gender').notNull(),
    weightClassId: uuid('weight_class_id').references(() => ruleWeightClass.id),
    movement: text('movement'),
  },
  (t) => [unique('category_key_uq').on(t.ruleSetId, t.categoryKey)],
);

/**
 * The committee's own arena/day schedule (uploaded from the SPS spreadsheet's "Jadwal FIX" tab),
 * read BEFORE any draw exists: a row here is a plain (discipline, gender, age division, weight
 * class) fact, not a foreign key to `category`, because `category` rows are only created lazily
 * the first time a draw run actually produces that categoryKey (draw-run-repository.ts) -- a
 * brand-new tournament has zero `category` rows. `weightClassCode` is null for a Poomsae entry,
 * which schedules by `format` instead (kept in that same column, since a schedule row is never
 * both at once).
 */
export const scheduleEntry = pgTable(
  'schedule_entry',
  {
    id: id(),
    tournamentId: tournamentRef(),
    dayNumber: smallint('day_number').notNull(),
    /** The calendar date only; the weekday is always computed from it at display time, never stored. */
    date: text('date').notNull(),
    arenaId: uuid('arena_id')
      .notNull()
      .references(() => arena.id),
    /** 0-based row order within this arena/day, exactly as the committee's own sheet listed it. */
    orderIndex: integer('order_index').notNull(),
    stream: streamEnum('stream').notNull(),
    discipline: disciplineEnum('discipline').notNull(),
    gender: categoryGenderEnum('gender').notNull(),
    ageDivisionCode: text('age_division_code').notNull(),
    /** A Kyorugi weight class ("-45") or a Poomsae format ("INDIVIDUAL"/"PAIR"/"TEAM"), matching
     * whichever the sheet's 4th column held for this row. */
    weightClassOrFormat: text('weight_class_or_format').notNull(),
  },
  (t) => [
    unique('schedule_entry_order_uq').on(t.tournamentId, t.arenaId, t.dayNumber, t.orderIndex),
    check('schedule_entry_day_ck', sql`${t.dayNumber} >= 1`),
  ],
);

// ---------------------------------------------------------------------------------------
// Draw runs (immutable once finished) and their candidate results
// ---------------------------------------------------------------------------------------

export const drawRun = pgTable(
  'draw_run',
  {
    id: id(),
    tournamentId: tournamentRef(),
    ruleSetId: uuid('rule_set_id')
      .notNull()
      .references(() => ruleSet.id),
    /** The immutable intake snapshot this run draws from (instruction 5). */
    intakeSnapshotId: uuid('intake_snapshot_id').notNull(),
    kind: drawRunKindEnum('kind').notNull(),
    status: drawRunStatusEnum('status').notNull().default('QUEUED'),
    seed: text('seed').notNull(),
    engineVersion: text('engine_version').notNull(),
    rulesSnapshot: jsonb('rules_snapshot').notNull(),
    rulesFingerprint: text('rules_fingerprint').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    outputFingerprint: text('output_fingerprint'),
    params: jsonb('params').notNull(),
    assumptions: jsonb('assumptions'),
    scope: jsonb('scope').notNull(),
    unsafeReasons: jsonb('unsafe_reasons')
      .notNull()
      .default(sql`'[]'::jsonb`),
    dualRunMatch: boolean('dual_run_match'),
    durationMs: integer('duration_ms'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => appUser.id),
    requestedAt: nowTs('requested_at'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.intakeSnapshotId, t.tournamentId],
      foreignColumns: [intakeSnapshot.id, intakeSnapshot.tournamentId],
    }),
    check('draw_run_seed_ck', sql`${t.seed} ~ '^(0|[1-9][0-9]{0,19})$'`),
    check(
      'draw_run_fingerprints_ck',
      sql`${t.rulesFingerprint} ~ ${sql.raw(FINGERPRINT_RE)} and ${t.inputFingerprint} ~ ${sql.raw(FINGERPRINT_RE)}`,
    ),
    check('draw_run_candidate_no_assumptions_ck', sql`${t.kind} <> 'CANDIDATE' or ${t.assumptions} is null`),
    check(
      'draw_run_finished_ck',
      sql`(${t.status} in ('SAFE', 'UNSAFE', 'FAILED')) = (${t.finishedAt} is not null)`,
    ),
    check('draw_run_safe_output_ck', sql`${t.status} <> 'SAFE' or ${t.outputFingerprint} is not null`),
    check(
      'draw_run_candidate_dual_run_ck',
      sql`${t.kind} <> 'CANDIDATE' or ${t.status} <> 'SAFE' or ${t.dualRunMatch} is true`,
    ),
    index('draw_run_tournament_ix').on(t.tournamentId, t.requestedAt),
  ],
);

export const drawRunCategory = pgTable(
  'draw_run_category',
  {
    drawRunId: uuid('draw_run_id')
      .notNull()
      .references(() => drawRun.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    readiness: categoryReadinessEnum('readiness').notNull(),
    blockedReasons: jsonb('blocked_reasons')
      .notNull()
      .default(sql`'[]'::jsonb`),
    selectedStrategy: poolStrategyEnum('selected_strategy'),
  },
  (t) => [
    primaryKey({ columns: [t.drawRunId, t.categoryId] }),
    check('draw_run_category_blocked_ck', sql`${t.readiness} = 'READY' or ${t.selectedStrategy} is null`),
  ],
);

/** Every strategy result is retained, not only the winner (ADR-0008). */
export const poolCandidate = pgTable(
  'pool_candidate',
  {
    drawRunId: uuid('draw_run_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    strategy: poolStrategyEnum('strategy').notNull(),
    rank: smallint('rank').notNull(),
    selected: boolean('selected').notNull(),
    tier0Violations: integer('tier0_violations').notNull(),
    tier1CostFp: bigint('tier1_cost_fp', { mode: 'number' }).notNull(),
    tier2CostFp: bigint('tier2_cost_fp', { mode: 'number' }).notNull(),
    partition: jsonb('partition').notNull(),
    metrics: jsonb('metrics').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.drawRunId, t.categoryId, t.strategy] }),
    foreignKey({
      columns: [t.drawRunId, t.categoryId],
      foreignColumns: [drawRunCategory.drawRunId, drawRunCategory.categoryId],
    }),
    uniqueIndex('pool_candidate_one_selected_uq')
      .on(t.drawRunId, t.categoryId)
      .where(sql`${t.selected}`),
    unique('pool_candidate_rank_uq').on(t.drawRunId, t.categoryId, t.rank),
    check('pool_candidate_selected_valid_ck', sql`not ${t.selected} or ${t.tier0Violations} = 0`),
  ],
);

// ---------------------------------------------------------------------------------------
// Revisions (copy-on-write snapshots, ADR-0004)
// ---------------------------------------------------------------------------------------

export const drawRevision = pgTable(
  'draw_revision',
  {
    id: id(),
    tournamentId: tournamentRef(),
    drawRunId: uuid('draw_run_id')
      .notNull()
      .references(() => drawRun.id),
    revisionNo: integer('revision_no').notNull(),
    parentRevisionId: uuid('parent_revision_id').references((): AnyPgColumn => drawRevision.id),
    lifecycle: revisionLifecycleEnum('lifecycle').notNull().default('DRAFT'),
    contentFingerprint: text('content_fingerprint'),
    lockVersion: integer('lock_version').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
    submittedAt: tstz('submitted_at'),
    approvedAt: tstz('approved_at'),
    approvedBy: uuid('approved_by').references(() => appUser.id),
    lockedAt: tstz('locked_at'),
    lockedBy: uuid('locked_by').references(() => appUser.id),
    publishedAt: tstz('published_at'),
    publishedBy: uuid('published_by').references(() => appUser.id),
    supersededAt: tstz('superseded_at'),
  },
  (t) => [
    unique('draw_revision_no_uq').on(t.drawRunId, t.revisionNo),
    check('draw_revision_no_ck', sql`${t.revisionNo} >= 1`),
    check('draw_revision_parent_ck', sql`(${t.revisionNo} = 1) = (${t.parentRevisionId} is null)`),
    check(
      'draw_revision_approved_ck',
      sql`${t.lifecycle} not in ('APPROVED', 'LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED') or (${t.approvedAt} is not null and ${t.approvedBy} is not null)`,
    ),
    check(
      'draw_revision_locked_ck',
      sql`${t.lifecycle} not in ('LOCKED', 'PUBLISHED', 'AMENDED', 'SUPERSEDED') or (${t.lockedAt} is not null and ${t.lockedBy} is not null and ${t.contentFingerprint} is not null)`,
    ),
    check(
      'draw_revision_published_ck',
      sql`${t.lifecycle} not in ('PUBLISHED', 'AMENDED', 'SUPERSEDED') or (${t.publishedAt} is not null and ${t.publishedBy} is not null)`,
    ),
    check(
      'draw_revision_superseded_ck',
      sql`(${t.lifecycle} = 'SUPERSEDED') = (${t.supersededAt} is not null)`,
    ),
    check('draw_revision_lock_version_ck', sql`${t.lockVersion} >= 0`),
  ],
);

/** At most one official (published) revision per category, enforced by the primary key. */
export const officialCategoryAssignment = pgTable('official_category_assignment', {
  categoryId: uuid('category_id')
    .primaryKey()
    .references(() => category.id),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => drawRevision.id),
  publishedAt: nowTs('published_at'),
});

export const pool = pgTable(
  'pool',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => drawRevision.id),
    poolUid: uuid('pool_uid').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    ordinal: integer('ordinal').notNull(),
    isWalkover: boolean('is_walkover').notNull(),
    metrics: jsonb('metrics').notNull(),
    explanation: jsonb('explanation').notNull(),
  },
  (t) => [
    unique('pool_uid_uq').on(t.revisionId, t.poolUid),
    unique('pool_ordinal_uq').on(t.revisionId, t.categoryId, t.ordinal),
    unique('pool_id_revision_uq').on(t.id, t.revisionId),
    check('pool_ordinal_ck', sql`${t.ordinal} >= 1`),
  ],
);

/** INV-02 at the database level: an entry appears at most once per revision. */
export const poolMember = pgTable(
  'pool_member',
  {
    poolId: uuid('pool_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entry.id),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.entryId] }),
    unique('pool_member_once_per_revision_uq').on(t.revisionId, t.entryId),
    foreignKey({ columns: [t.poolId, t.revisionId], foreignColumns: [pool.id, pool.revisionId] }),
  ],
);

export const bracket = pgTable(
  'bracket',
  {
    id: id(),
    poolId: uuid('pool_id').notNull().unique(),
    revisionId: uuid('revision_id').notNull(),
    size: integer('size').notNull(),
    rounds: smallint('rounds').notNull(),
    entries: integer('entries').notNull(),
    byes: integer('byes').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.poolId, t.revisionId], foreignColumns: [pool.id, pool.revisionId] }),
    check('bracket_power_of_two_ck', sql`${t.size} >= 2 and (${t.size} & (${t.size} - 1)) = 0`),
    check('bracket_entries_ck', sql`${t.entries} >= 1 and ${t.entries} <= ${t.size}`),
    check('bracket_byes_ck', sql`${t.byes} = ${t.size} - ${t.entries}`),
    check('bracket_rounds_ck', sql`(1 << ${t.rounds}) = ${t.size}`),
  ],
);

export const bracketSlot = pgTable(
  'bracket_slot',
  {
    bracketId: uuid('bracket_id')
      .notNull()
      .references(() => bracket.id),
    position: smallint('position').notNull(),
    entryId: uuid('entry_id').references(() => entry.id),
    seedNo: smallint('seed_no'),
    byeReason: jsonb('bye_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.bracketId, t.position] }),
    unique('bracket_slot_entry_uq').on(t.bracketId, t.entryId),
    check('bracket_slot_position_ck', sql`${t.position} >= 1`),
    check('bracket_slot_bye_reason_ck', sql`(${t.entryId} is null) = (${t.byeReason} is not null)`),
    check(
      'bracket_slot_seed_ck',
      sql`${t.seedNo} is null or (${t.entryId} is not null and ${t.seedNo} >= 1)`,
    ),
  ],
);

export const match = pgTable(
  'match',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => drawRevision.id),
    matchUid: uuid('match_uid').notNull(),
    bracketId: uuid('bracket_id')
      .notNull()
      .references(() => bracket.id),
    round: smallint('round').notNull(),
    position: smallint('position').notNull(),
    feederASlot: smallint('feeder_a_slot'),
    feederAMatchId: uuid('feeder_a_match_id').references((): AnyPgColumn => match.id),
    feederBSlot: smallint('feeder_b_slot'),
    feederBMatchId: uuid('feeder_b_match_id').references((): AnyPgColumn => match.id),
    arenaId: uuid('arena_id').references(() => arena.id),
    orderNo: integer('order_no'),
    publicCode: text('public_code'),
    /**
     * Presentation-only display number the drawing team can set for the FINAL/OFFICIAL bracket
     * sheet (e.g. "1", "2", "3" printed on the document), completely independent of `publicCode`/
     * `matchUid`, which stay the stable internal identity. Null means "use the deterministic
     * document-order default" (see documentMatchNumbers in packages/export). Never read by the
     * draw engine or any safety invariant -- display only.
     */
    displayNo: integer('display_no'),
    status: matchStatusEnum('status').notNull().default('PENDING'),
  },
  (t) => [
    unique('match_uid_uq').on(t.revisionId, t.matchUid),
    unique('match_position_uq').on(t.bracketId, t.round, t.position),
    uniqueIndex('match_public_code_uq')
      .on(t.revisionId, t.publicCode)
      .where(sql`${t.publicCode} is not null`),
    check('match_round_ck', sql`${t.round} >= 1 and ${t.position} >= 1`),
    check('match_feeder_a_ck', sql`(${t.feederASlot} is null) <> (${t.feederAMatchId} is null)`),
    check('match_feeder_b_ck', sql`(${t.feederBSlot} is null) <> (${t.feederBMatchId} is null)`),
    check(
      'match_public_code_ck',
      sql`${t.publicCode} is null or ${t.publicCode} ~ '^[A-Z]{1,3}[0-9]{3,4}[A-Z]?$'`,
    ),
    check('match_display_no_ck', sql`${t.displayNo} is null or ${t.displayNo} >= 1`),
  ],
);

/**
 * Public match codes are allocated once per logical match and never reused in the tournament
 * (ADR-0005). Rows are never deleted; retirement is recorded, not erased.
 */
export const matchCodeRegistry = pgTable(
  'match_code_registry',
  {
    tournamentId: tournamentRef(),
    publicCode: text('public_code').notNull(),
    arenaId: uuid('arena_id')
      .notNull()
      .references(() => arena.id),
    matchUid: uuid('match_uid').notNull(),
    firstRevisionId: uuid('first_revision_id')
      .notNull()
      .references(() => drawRevision.id),
    retiredRevisionId: uuid('retired_revision_id').references(() => drawRevision.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tournamentId, t.publicCode] }),
    unique('match_code_registry_uid_uq').on(t.tournamentId, t.matchUid),
  ],
);

export const qualityReport = pgTable(
  'quality_report',
  {
    id: id(),
    drawRunId: uuid('draw_run_id').references(() => drawRun.id),
    revisionId: uuid('revision_id').references(() => drawRevision.id),
    report: jsonb('report').notNull(),
    fingerprint: text('fingerprint').notNull(),
    errorCount: integer('error_count').notNull(),
    warningCount: integer('warning_count').notNull(),
    infoCount: integer('info_count').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('quality_report_subject_ck', sql`(${t.drawRunId} is null) <> (${t.revisionId} is null)`),
    check(
      'quality_report_counts_ck',
      sql`${t.errorCount} >= 0 and ${t.warningCount} >= 0 and ${t.infoCount} >= 0`,
    ),
  ],
);

/** LOCK requires every WARNING of the revision's quality report to be acknowledged with a reason. */
export const warningAcknowledgement = pgTable(
  'warning_acknowledgement',
  {
    id: id(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => drawRevision.id),
    findingCode: text('finding_code').notNull(),
    findingSubject: text('finding_subject').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => appUser.id),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('warning_acknowledgement_uq').on(t.revisionId, t.findingCode, t.findingSubject),
    check('warning_acknowledgement_reason_ck', sql`char_length(btrim(${t.reason})) >= 15`),
  ],
);
