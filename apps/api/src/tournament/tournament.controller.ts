import type { Db } from '@bagantkd/db';
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

/**
 * Phase 5 (smallest missing contract, ACCEPTANCE §NON-NEGOTIABLE BASELINE): the operator UI needs
 * a landing summary for a tournament — which draw run and revision is current — and a member list
 * to drive the dev-only persona switcher (there is no login system; see auth/actor.ts). Neither
 * existed after Phase 4, whose endpoint list started at draw-run creation.
 */
@Controller('tournaments/:id')
@UseGuards(ActorGuard)
@TournamentScope('tournament', 'id')
export class TournamentController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async summary(@Param('id') id: string): Promise<Record<string, unknown>> {
    const [tournament] = await this.db.query<{ id: string; code: string; name: string }>(
      `select id, code, name from tournament where id = $1`,
      [id],
    );
    if (!tournament) throw new ApiError('TOURNAMENT_NOT_FOUND');

    const [latestRun] = await this.db.query<{
      id: string;
      status: string;
      kind: string;
      requested_at: string;
      finished_at: string | null;
    }>(
      `select id, status, kind, requested_at, finished_at from draw_run where tournament_id = $1 order by requested_at desc limit 1`,
      [id],
    );

    let latestRevision: Record<string, unknown> | null = null;
    if (latestRun) {
      const [rev] = await this.db.query<{
        id: string;
        revision_no: number;
        lifecycle: string;
        lock_version: number;
      }>(
        `select id, revision_no, lifecycle, lock_version from draw_revision where draw_run_id = $1 order by revision_no desc limit 1`,
        [latestRun.id],
      );
      latestRevision = rev ?? null;
    }

    const [categoryCounts] = await this.db.query<{ total: string; ready: string; blocked: string }>(
      latestRun
        ? `select count(*) total, count(*) filter (where readiness = 'READY') ready, count(*) filter (where readiness = 'BLOCKED') blocked
           from draw_run_category where draw_run_id = $1`
        : `select 0 total, 0 ready, 0 blocked`,
      latestRun ? [latestRun.id] : [],
    );

    const [warningCounts] = latestRun
      ? await this.db.query<{ warning_count: number; error_count: number }>(
          `select warning_count, error_count from quality_report where draw_run_id = $1`,
          [latestRun.id],
        )
      : [undefined];

    const [ruleSetRow] = await this.db.query<{ status: string }>(
      `select status from rule_set where tournament_id = $1 and status = 'ACTIVE' limit 1`,
      [id],
    );

    return {
      id: tournament.id,
      code: tournament.code,
      name: tournament.name,
      activeRuleSetStatus: ruleSetRow?.status ?? 'NONE',
      latestDrawRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            kind: latestRun.kind,
            requestedAt: latestRun.requested_at,
            finishedAt: latestRun.finished_at,
          }
        : null,
      latestRevision,
      categoryCounts: {
        total: Number(categoryCounts?.total ?? 0),
        ready: Number(categoryCounts?.ready ?? 0),
        blocked: Number(categoryCounts?.blocked ?? 0),
      },
      warningCount: warningCounts?.warning_count ?? 0,
      errorCount: warningCounts?.error_count ?? 0,
    };
  }

  /** DEV AUTH ONLY: backs the persona switcher — never a substitute for real login (see auth/actor.ts). */
  @Get('members')
  async members(@Param('id') id: string): Promise<readonly Record<string, unknown>[]> {
    return this.db.query(
      `select tm.user_id, tm.role, u.display_name, u.email from tournament_member tm join app_user u on u.id = tm.user_id where tm.tournament_id = $1 order by tm.role desc, u.display_name`,
      [id],
    );
  }

  /**
   * Operator search (ACCEPTANCE §B "search participant / search contingent"): with 200+
   * categories, finding "which category is this athlete in" cannot be done by loading every
   * category client-side. Matches external_ref, contingent name, or athlete full name; never
   * selects NIK columns.
   */
  @Get('search')
  async search(@Param('id') id: string, @Query('q') q?: string): Promise<readonly Record<string, unknown>[]> {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    return this.db.query(
      `select distinct e.id as entry_id, e.external_ref, c.name as contingent, e.category_id, cat.category_key
       from entry e
       join contingent c on c.id = e.contingent_id
       left join category cat on cat.id = e.category_id
       left join entry_member em on em.entry_id = e.id
       left join athlete a on a.id = em.athlete_id
       where e.tournament_id = $1
         and (e.external_ref ilike $2 or c.name ilike $2 or a.full_name ilike $2)
       order by c.name
       limit 25`,
      [id, `%${term}%`],
    );
  }
}
