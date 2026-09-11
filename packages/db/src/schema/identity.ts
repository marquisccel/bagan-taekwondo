import { sql } from 'drizzle-orm';
import { check, date, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, nowTs, tstz } from './columns.js';
import { roleEnum, tournamentStatusEnum } from './enums.js';

export const appUser = pgTable(
  'app_user',
  {
    id: id(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
    disabledAt: tstz('disabled_at'),
  },
  (t) => [uniqueIndex('app_user_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const tournament = pgTable(
  'tournament',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    eventStart: date('event_start').notNull(),
    eventEnd: date('event_end').notNull(),
    timezone: text('timezone').notNull(),
    status: tournamentStatusEnum('status').notNull().default('DRAFT'),
    createdAt: createdAt(),
  },
  (t) => [check('tournament_dates_ck', sql`${t.eventStart} <= ${t.eventEnd}`)],
);

/** Role grants are scoped to one tournament (tenant boundary). */
export const tournamentMember = pgTable(
  'tournament_member',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    role: roleEnum('role').notNull(),
    grantedBy: uuid('granted_by').references(() => appUser.id),
    grantedAt: nowTs('granted_at'),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId, t.role] })],
);
