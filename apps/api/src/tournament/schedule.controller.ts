import { createDrawRun, type Db } from '@bagantkd/db';
import type { SnapshotEntry } from '@bagantkd/intake';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';

import type { Actor } from '../auth/actor';
import { ActorGuard } from '../auth/actor.guard';
import { CurrentActor } from '../auth/current-actor.decorator';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import { JobQueue, JOB_QUEUE } from '../jobs/job-queue.module';
import { body, num, str } from '../validation';

interface ScheduleRowDb {
  readonly day_number: number;
  readonly date: string;
  readonly arena_code: string;
  readonly category_count: string;
}

interface SlotRowDb {
  readonly stream: string;
  readonly discipline: string;
  readonly gender: string;
  readonly age_division_code: string;
  readonly weight_class_or_format: string;
}

/** `categoryKey` is `TEMPLATE|DIM=VALUE|DIM=VALUE|...` (packages/intake/src/categories.ts,
 * `deriveCategory`) — a plain lookup, not a re-derivation. */
function categoryKeyDims(categoryKey: string): ReadonlyMap<string, string> {
  const dims = new Map<string, string>();
  for (const part of categoryKey.split('|').slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) dims.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return dims;
}

/**
 * `GET /tournaments/:id/schedule` and `POST /tournaments/:id/draw-runs/from-schedule`: the
 * committee's own arena/day schedule (uploaded via `POST /uploads/sps`, schedule_entry table), and
 * generating a draw scoped to exactly the categories one arena/day slot schedules.
 *
 * The scope is computed by a throwaway, unpersisted SIMULATION run (`runDraw` called directly, not
 * `createDrawRun` -- this discovery pass never becomes a draw_run row): its READY categories are
 * matched against the slot's schedule rows by (discipline, stream, gender, age division, weight
 * class/format) parsed straight out of each categoryKey, then that matched subset becomes the
 * scope of the real, persisted, queued draw run.
 */
@Controller('tournaments/:id')
@UseGuards(ActorGuard)
@TournamentScope('tournament', 'id')
export class ScheduleController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  @Get('schedule')
  async schedule(@Param('id') id: string): Promise<readonly Record<string, unknown>[]> {
    const rows = await this.db.query<ScheduleRowDb>(
      `select se.day_number, to_char(se.date::date, 'YYYY-MM-DD') as date, a.code as arena_code, count(*) as category_count
       from schedule_entry se join arena a on a.id = se.arena_id
       where se.tournament_id = $1
       group by se.day_number, se.date, a.code
       order by se.day_number, a.code`,
      [id],
    );
    return rows.map((r) => ({
      dayNumber: r.day_number,
      date: r.date,
      arenaCode: r.arena_code,
      categoryCount: Number(r.category_count),
    }));
  }

  @Post('draw-runs/from-schedule')
  async generateFromSchedule(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<{ drawRunId: string; status: 'QUEUED'; matchedCategoryCount: number }> {
    const b = body(raw);
    const dayNumber = num(b, 'dayNumber');
    const arenaCode = str(b, 'arenaCode');
    const seed = str(b, 'seed');

    const slotRows = await this.db.query<SlotRowDb>(
      `select se.stream, se.discipline, se.gender, se.age_division_code, se.weight_class_or_format
       from schedule_entry se join arena a on a.id = se.arena_id
       where se.tournament_id = $1 and se.day_number = $2 and a.code = $3`,
      [id, dayNumber, arenaCode],
    );
    if (slotRows.length === 0) {
      throw new ApiError('VALIDATION_ERROR', `no schedule rows for day ${dayNumber} arena ${arenaCode}`);
    }

    const [ruleSetRow] = await this.db.query<{ id: string; snapshot: RuleSet; fingerprint: string }>(
      `select id, snapshot, fingerprint from rule_set where tournament_id = $1 and status = 'ACTIVE' order by version desc limit 1`,
      [id],
    );
    if (!ruleSetRow?.snapshot)
      throw new ApiError('RULE_SET_NOT_READY', 'no ACTIVE rule set for this tournament');

    const [snapshotRow] = await this.db.query<{ id: string; content: { entries: SnapshotEntry[] } }>(
      `select id, content from intake_snapshot where tournament_id = $1 order by created_at desc limit 1`,
      [id],
    );
    if (!snapshotRow) throw new ApiError('VALIDATION_ERROR', 'no registration data for this tournament yet');

    const parsedSeed = parseDrawSeed(seed);

    // Idempotent: the web app derives `seed` deterministically from (tournament, day, arena), so
    // re-clicking "Buat Bagan"/"Lihat Bagan" for the same slot must return the existing draw run
    // instead of queuing a new one every time -- otherwise the tournament's "latest revision"
    // flips to the new (still-QUEUED) run and the team briefly loses the results they were just
    // looking at.
    const [existing] = await this.db.query<{ id: string }>(
      `select id from draw_run where tournament_id = $1 and seed = $2 order by requested_at desc limit 1`,
      [id, seed],
    );
    if (existing) {
      const [row] = await this.db.query<{ count: number }>(
        `select jsonb_array_length(scope) as count from draw_run where id = $1`,
        [existing.id],
      );
      return { drawRunId: existing.id, status: 'QUEUED', matchedCategoryCount: row?.count ?? 0 };
    }

    const entries = snapshotRow.content.entries;
    const plan = runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION',
      seed: parsedSeed,
      ruleSet: ruleSetRow.snapshot,
      entries,
      scope: [],
      assumptions: null,
    });

    const scope = plan.categories
      .filter((c) => c.readiness === 'READY')
      .filter((c) => {
        const dims = categoryKeyDims(c.categoryKey);
        return slotRows.some(
          (row) =>
            dims.get('DISCIPLINE') === row.discipline &&
            dims.get('STREAM') === row.stream &&
            dims.get('GENDER') === row.gender &&
            dims.get('AGE_DIVISION') === row.age_division_code &&
            (dims.get('WEIGHT_CLASS') === row.weight_class_or_format ||
              dims.get('FORMAT') === row.weight_class_or_format),
        );
      })
      .map((c) => c.categoryKey);

    if (scope.length === 0) {
      // A friendly, specific reason when the whole slot is simply out of this system's current scope
      // (only SEMI_PRESTASI is imported/drawn here) rather than a genuine data problem -- an admin
      // reading this should immediately understand there is nothing to fix, not chase a phantom bug.
      const streams = [...new Set(slotRows.map((r) => r.stream))];
      const message =
        streams.length === 1 && streams[0] !== 'SEMI_PRESTASI'
          ? `Arena ${arenaCode} hari ke-${dayNumber} berisi kelas ${streams[0] === 'PRESTASI' ? 'Prestasi' : streams[0]}, bukan Semi Prestasi. Sistem ini baru mendukung Semi Prestasi, jadi tidak ada bagan yang dibuat untuk slot ini.`
          : `Tidak ada kategori siap untuk arena ${arenaCode} hari ke-${dayNumber}. Periksa kembali data peserta pada slot ini.`;
      throw new ApiError('VALIDATION_ERROR', message);
    }

    const created = await this.db.transaction((tx) =>
      createDrawRun(tx, {
        tournamentId: id,
        ruleSetId: ruleSetRow.id,
        ruleSetSnapshot: ruleSetRow.snapshot,
        ruleSetFingerprint: ruleSetRow.fingerprint,
        intakeSnapshotId: snapshotRow.id,
        intakeEntries: entries,
        kind: 'CANDIDATE',
        seed,
        scope,
        assumptions: null,
        requestedBy: actor.userId,
      }),
    );
    await this.jobs.enqueueDrawRun(created.drawRunId);
    return { drawRunId: created.drawRunId, status: 'QUEUED', matchedCategoryCount: scope.length };
  }
}
