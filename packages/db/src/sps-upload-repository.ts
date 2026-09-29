import { runIntake, type ScheduleRow } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { DomainError } from '@bagantkd/shared';

import type { Db } from './db.js';
import { persistIntake } from './intake-repository.js';
import type { NikKeys } from './nik-crypto.js';
import { persistRuleSet } from './rule-set-repository.js';

/**
 * The whole "upload one SPS spreadsheet" bootstrap in one transaction (Phase 6+, arena/day
 * scheduling): create the tournament, its arenas, its rule set, its schedule (from the committee's
 * "Jadwal FIX" tab, already parsed to `ScheduleRow[]` by `@bagantkd/intake`'s `parseJadwalFixSheet`),
 * and its participant roster (already extracted to a CSV `Uint8Array` by that same package's
 * `extractParticipantCsv`, fed through the existing, unmodified `runIntake` pipeline).
 *
 * One shared actor for the whole team (ADR: "no role gating" -- the team explicitly asked not to
 * distinguish roles for this workflow): a single `app_user` row, reused across uploads by its fixed
 * email, given `ADMIN` membership on every tournament this function creates so every action in the
 * app succeeds for it without further setup.
 */

const TEAM_ACTOR_EMAIL = 'team@bagantkd.local';

export interface SpsUploadArgs {
  readonly tournamentName: string;
  readonly tournamentCode: string;
  readonly ruleSet: RuleSet;
  readonly scheduleRows: readonly ScheduleRow[];
  /** CSV bytes matching `KOLEKTIF_2026_COLUMNS`, e.g. from `extractParticipantCsv`. */
  readonly participantCsv: Uint8Array;
  readonly nikKeys: NikKeys;
}

export interface SpsUploadResult {
  readonly tournamentId: string;
  readonly actorId: string;
  readonly ruleSetId: string;
  readonly intakeSnapshotId: string;
  readonly participantCount: number;
  readonly scheduleRowCount: number;
  readonly arenaCodes: readonly string[];
  readonly eventStart: string;
  readonly eventEnd: string;
}

const one = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new Error('INSERT ... RETURNING produced no row');
  return row;
};

export async function persistSpsUpload(db: Db, args: SpsUploadArgs): Promise<SpsUploadResult> {
  if (args.scheduleRows.length === 0) {
    throw new DomainError('SPS_SCHEDULE_EMPTY', {}, 'the "Jadwal FIX" sheet produced no usable rows');
  }
  const dates = [...new Set(args.scheduleRows.map((r) => r.date))].sort();
  const eventStart = dates[0] as string;
  const eventEnd = dates[dates.length - 1] as string;
  const arenaCodes = [...new Set(args.scheduleRows.map((r) => r.arenaCode))].sort();

  return db.transaction(async (tx) => {
    const actorId = one(
      await tx.query<{ id: string }>(
        `insert into app_user (email, display_name, password_hash) values ($1, 'Tim', 'x')
         on conflict (lower(email)) do update set display_name = excluded.display_name returning id`,
        [TEAM_ACTOR_EMAIL],
      ),
    ).id;

    const tournamentId = one(
      await tx.query<{ id: string }>(
        `insert into tournament (code, name, event_start, event_end, timezone)
         values ($1, $2, $3, $4, 'Asia/Jakarta') returning id`,
        [args.tournamentCode, args.tournamentName, eventStart, eventEnd],
      ),
    ).id;

    await tx.query(`insert into tournament_member (tournament_id, user_id, role) values ($1, $2, 'ADMIN')`, [
      tournamentId,
      actorId,
    ]);

    const arenaIdByCode = new Map<string, string>();
    for (const code of arenaCodes) {
      const row = one(
        await tx.query<{ id: string }>(
          `insert into arena (tournament_id, code, name) values ($1, $2, $2) returning id`,
          [tournamentId, code],
        ),
      );
      arenaIdByCode.set(code, row.id);
    }

    const persistedRuleSet = await persistRuleSet(tx, {
      tournamentId,
      actorId,
      ruleSet: args.ruleSet,
    });

    for (const row of args.scheduleRows) {
      const arenaId = arenaIdByCode.get(row.arenaCode);
      if (!arenaId) throw new Error(`unreachable: arena ${row.arenaCode} was not created`);
      await tx.query(
        `insert into schedule_entry
           (tournament_id, day_number, date, arena_id, order_index, stream, discipline, gender, age_division_code, weight_class_or_format)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          tournamentId,
          row.dayNumber,
          row.date,
          arenaId,
          row.orderIndex,
          row.stream,
          row.discipline,
          row.gender,
          row.ageDivisionCode,
          row.weightClassOrFormat,
        ],
      );
    }

    const intake = runIntake({
      sourceName: 'sps-upload.xlsx',
      bytes: args.participantCsv,
      ruleSet: args.ruleSet,
    });
    if (!intake.snapshot) {
      throw new DomainError(
        'SPS_PARTICIPANTS_INVALID',
        {},
        'the participant sheet produced no usable snapshot',
      );
    }
    const saved = await persistIntake(tx, {
      tournamentId,
      ruleSetId: persistedRuleSet.ruleSetId,
      actorId,
      result: intake,
      nikKeys: args.nikKeys,
      mode: 'INITIAL',
    });

    return {
      tournamentId,
      actorId,
      ruleSetId: persistedRuleSet.ruleSetId,
      intakeSnapshotId: saved.snapshotId,
      participantCount: intake.snapshot.entries.length,
      scheduleRowCount: args.scheduleRows.length,
      arenaCodes,
      eventStart,
      eventEnd,
    };
  });
}
