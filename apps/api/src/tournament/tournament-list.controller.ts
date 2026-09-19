import type { Db } from '@bagantkd/db';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { CurrentActorId } from '../auth/current-actor.decorator';
import { ActorScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';

interface ListRow {
  id: string;
  code: string;
  name: string;
  status: string;
  event_start: string;
  event_end: string;
  active_rule_set_status: string;
  run_id: string | null;
  run_status: string | null;
  run_kind: string | null;
  run_requested_at: string | null;
  run_finished_at: string | null;
  rev_id: string | null;
  rev_no: number | null;
  rev_lifecycle: string | null;
  rev_lock_version: number | null;
  cat_total: number;
  cat_ready: number;
  cat_blocked: number;
}

/**
 * `GET /tournaments` (AUD-008): the tournaments the caller is a member of, with the same
 * latest-run / latest-revision / category-count fields as the per-tournament summary
 * (`TournamentController.summary`) — computed in ONE query with lateral joins so the list does not
 * cost N+1 round trips. There is no global-admin bypass in this system: every role, ADMIN included,
 * is scoped to a tournament through `tournament_member` (auth/actor.ts), so membership IS the rule.
 */
@Controller('tournaments')
@UseGuards(ActorGuard)
@ActorScope()
export class TournamentListController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@CurrentActorId() actorId: string): Promise<readonly Record<string, unknown>[]> {
    const rows = await this.db.query<ListRow>(
      `select t.id, t.code, t.name, t.status,
              to_char(t.event_start, 'YYYY-MM-DD') as event_start,
              to_char(t.event_end, 'YYYY-MM-DD') as event_end,
              coalesce((select rs.status::text from rule_set rs where rs.tournament_id = t.id and rs.status = 'ACTIVE' limit 1), 'NONE') as active_rule_set_status,
              lr.id as run_id, lr.status as run_status, lr.kind as run_kind,
              lr.requested_at as run_requested_at, lr.finished_at as run_finished_at,
              rev.id as rev_id, rev.revision_no as rev_no, rev.lifecycle as rev_lifecycle, rev.lock_version as rev_lock_version,
              coalesce(cc.total, 0)::int as cat_total, coalesce(cc.ready, 0)::int as cat_ready, coalesce(cc.blocked, 0)::int as cat_blocked
       from tournament t
       left join lateral (
         select id, status, kind, requested_at, finished_at from draw_run
         where tournament_id = t.id order by requested_at desc limit 1
       ) lr on true
       left join lateral (
         select id, revision_no, lifecycle, lock_version from draw_revision
         where draw_run_id = lr.id order by revision_no desc limit 1
       ) rev on true
       left join lateral (
         select count(*) as total,
                count(*) filter (where readiness = 'READY') as ready,
                count(*) filter (where readiness = 'BLOCKED') as blocked
         from draw_run_category where draw_run_id = lr.id
       ) cc on true
       where exists (select 1 from tournament_member tm where tm.tournament_id = t.id and tm.user_id::text = $1)
       order by t.event_start desc, t.name, t.id`,
      [actorId],
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      eventStart: r.event_start,
      eventEnd: r.event_end,
      activeRuleSetStatus: r.active_rule_set_status,
      latestDrawRun: r.run_id
        ? {
            id: r.run_id,
            status: r.run_status,
            kind: r.run_kind,
            requestedAt: r.run_requested_at,
            finishedAt: r.run_finished_at,
          }
        : null,
      latestRevision: r.rev_id
        ? {
            id: r.rev_id,
            revision_no: r.rev_no,
            lifecycle: r.rev_lifecycle,
            lock_version: r.rev_lock_version,
          }
        : null,
      categoryCounts: { total: r.cat_total, ready: r.cat_ready, blocked: r.cat_blocked },
    }));
  }
}
