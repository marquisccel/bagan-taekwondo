import { createDrawRun, type Db } from '@bagantkd/db';
import type { SnapshotEntry } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, UseGuards } from '@nestjs/common';

import type { Actor } from '../auth/actor';
import { ActorGuard } from '../auth/actor.guard';
import { CurrentActor } from '../auth/current-actor.decorator';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import { JobQueue, JOB_QUEUE } from '../jobs/job-queue.module';
import { body, oneOf, str } from '../validation';

/**
 * POST /tournaments/:id/draw-runs, GET /draw-runs/:id[/quality|/categories] (Phase 4 §14).
 * References an already-persisted, ACTIVE rule set and a committed intake snapshot (both created
 * by the intake/rule-set pipeline, out of this endpoint's scope) and enqueues execution — the
 * frozen engine itself runs only in apps/worker.
 */
@Controller()
@UseGuards(ActorGuard)
export class DrawRunController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  @Post('tournaments/:id/draw-runs')
  @TournamentScope('tournament', 'id')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id') tournamentId: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<{ drawRunId: string; inputFingerprint: string; status: 'QUEUED' }> {
    if (actor.role === 'VIEWER')
      throw new ApiError('FORBIDDEN_COMMAND', 'role VIEWER may not create draw runs');
    const b = body(raw);
    const ruleSetId = str(b, 'ruleSetId');
    const intakeSnapshotId = str(b, 'intakeSnapshotId');
    const kind = oneOf(b, 'kind', ['CANDIDATE', 'SIMULATION'] as const);
    const seed = str(b, 'seed');
    const scopeRaw = b['scope'];
    if (!Array.isArray(scopeRaw) || !scopeRaw.every((s) => typeof s === 'string'))
      throw new ApiError('VALIDATION_ERROR', 'scope must be a string array');
    const scope = scopeRaw;
    const assumptionsRaw = b['assumptions'];
    if (assumptionsRaw !== undefined && assumptionsRaw !== null && typeof assumptionsRaw !== 'object')
      throw new ApiError('VALIDATION_ERROR', 'assumptions must be an object or null');

    const [ruleSetRow] = await this.db.query<{
      snapshot: RuleSet | null;
      fingerprint: string | null;
      status: string;
      tournament_id: string;
    }>(`select snapshot, fingerprint, status, tournament_id from rule_set where id = $1`, [ruleSetId]);
    if (!ruleSetRow || ruleSetRow.tournament_id !== tournamentId)
      throw new ApiError('RULE_SET_NOT_READY', 'rule set not found for this tournament');
    if (ruleSetRow.status !== 'ACTIVE' || !ruleSetRow.snapshot || !ruleSetRow.fingerprint)
      throw new ApiError('RULE_SET_NOT_READY', 'rule set is not ACTIVE');

    const [snapshotRow] = await this.db.query<{
      content: { entries: SnapshotEntry[] };
      tournament_id: string;
    }>(`select content, tournament_id from intake_snapshot where id = $1`, [intakeSnapshotId]);
    if (!snapshotRow || snapshotRow.tournament_id !== tournamentId)
      throw new ApiError('VALIDATION_ERROR', 'intake snapshot not found for this tournament');

    const created = await this.db.transaction((tx) =>
      createDrawRun(tx, {
        tournamentId,
        ruleSetId,
        ruleSetSnapshot: ruleSetRow.snapshot as RuleSet,
        ruleSetFingerprint: ruleSetRow.fingerprint as string,
        intakeSnapshotId,
        intakeEntries: snapshotRow.content.entries,
        kind,
        seed,
        scope,
        assumptions: (assumptionsRaw as never) ?? null,
        requestedBy: actor.userId,
      }),
    );
    await this.jobs.enqueueDrawRun(created.drawRunId);
    return { drawRunId: created.drawRunId, inputFingerprint: created.inputFingerprint, status: 'QUEUED' };
  }

  @Get('draw-runs/:id')
  @TournamentScope('draw-run', 'id')
  async get(@Param('id') id: string): Promise<Record<string, unknown>> {
    const [row] = await this.db.query(
      `select id, tournament_id, rule_set_id, kind, status, seed, engine_version, rules_fingerprint, input_fingerprint, output_fingerprint,
              scope, unsafe_reasons, dual_run_match, duration_ms, requested_by, requested_at, started_at, finished_at
       from draw_run where id = $1`,
      [id],
    );
    if (!row) throw new ApiError('DRAW_RUN_NOT_FOUND');
    return row;
  }

  @Get('draw-runs/:id/quality')
  @TournamentScope('draw-run', 'id')
  async quality(@Param('id') id: string): Promise<Record<string, unknown>> {
    const [run] = await this.db.query<{ status: string }>(`select status from draw_run where id = $1`, [id]);
    if (!run) throw new ApiError('DRAW_RUN_NOT_FOUND');
    if (run.status === 'QUEUED' || run.status === 'RUNNING')
      throw new ApiError('DRAW_RUN_NOT_READY', `draw run is ${run.status}`);
    if (run.status === 'UNSAFE' || run.status === 'FAILED')
      throw new ApiError('DRAW_RUN_UNSAFE', `draw run is ${run.status}`);
    const [report] = await this.db.query<{
      report: unknown;
      fingerprint: string;
      error_count: number;
      warning_count: number;
      info_count: number;
    }>(
      `select report, fingerprint, error_count, warning_count, info_count from quality_report where draw_run_id = $1`,
      [id],
    );
    if (!report) throw new ApiError('DRAW_RUN_NOT_FOUND', 'no quality report for this draw run');
    return report;
  }

  @Get('draw-runs/:id/categories')
  @TournamentScope('draw-run', 'id')
  async categories(@Param('id') id: string): Promise<readonly Record<string, unknown>[]> {
    const [run] = await this.db.query<{ status: string }>(`select status from draw_run where id = $1`, [id]);
    if (!run) throw new ApiError('DRAW_RUN_NOT_FOUND');
    const categories = await this.db.query<{
      category_id: string;
      category_key: string;
      readiness: string;
      blocked_reasons: unknown;
      selected_strategy: string | null;
    }>(
      `select rc.category_id, c.category_key, rc.readiness, rc.blocked_reasons, rc.selected_strategy
       from draw_run_category rc join category c on c.id = rc.category_id where rc.draw_run_id = $1 order by c.category_key`,
      [id],
    );
    const candidates = await this.db.query<{
      category_id: string;
      strategy: string;
      rank: number;
      selected: boolean;
      tier0_violations: number;
      tier1_cost_fp: number;
      tier2_cost_fp: number;
      metrics: unknown;
    }>(
      `select category_id, strategy, rank, selected, tier0_violations, tier1_cost_fp, tier2_cost_fp, metrics from pool_candidate where draw_run_id = $1 order by category_id, rank`,
      [id],
    );
    return categories.map((c) => ({
      ...c,
      candidates: candidates.filter((cand) => cand.category_id === c.category_id),
    }));
  }
}
