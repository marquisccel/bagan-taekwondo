import type { Db } from '@bagantkd/db';
import { isPlaceable, type EligibilityStatus } from '@bagantkd/domain';
import { assessRuleSet, type RuleSetFinding } from '@bagantkd/rules';
import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';

import type { Actor } from '../auth/actor';
import { ActorGuard } from '../auth/actor.guard';
import { CurrentActor } from '../auth/current-actor.decorator';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

/**
 * `GET /tournaments/:id/draw-preflight` (AUD-010): everything the operator needs to see BEFORE
 * pressing "Buat Drawing", read-only. It only reads what is already persisted — the active rule
 * set, the latest intake snapshot, entry eligibility, open validation issues — and asks the
 * existing `assessRuleSet(..., 'LOCK')` whether the rule set is still provisional. No eligibility
 * or rule logic is re-implemented; `POST /tournaments/:id/draw-runs` stays the only place a draw
 * is requested and it re-validates everything itself.
 */
@Controller('tournaments/:id')
@UseGuards(ActorGuard)
@TournamentScope('tournament', 'id')
export class DrawPreflightController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('draw-preflight')
  async preflight(
    @Param('id') tournamentId: string,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const [tournament] = await this.db.query<{ id: string; code: string; name: string }>(
      `select id, code, name from tournament where id = $1`,
      [tournamentId],
    );
    if (!tournament) throw new ApiError('TOURNAMENT_NOT_FOUND');

    // The ACTIVE rule set is the only one a draw run may reference; show the newest one otherwise so
    // the operator can see WHY there is nothing to draw with.
    const [ruleSet] = await this.db.query<{
      id: string;
      code: string;
      version: number;
      name: string;
      status: string;
      snapshot: unknown;
    }>(
      `select id, code, version, name, status, snapshot from rule_set
       where tournament_id = $1 order by (status = 'ACTIVE') desc, version desc limit 1`,
      [tournamentId],
    );

    let ruleSetLock: Record<string, unknown> | null = null;
    if (ruleSet?.snapshot) {
      const assessment = assessRuleSet(ruleSet.snapshot, 'LOCK');
      const counted = new Map<string, { code: string; level: RuleSetFinding['level']; count: number }>();
      for (const f of assessment.findings) {
        if (f.level === 'INFO') continue;
        const key = `${f.level}|${f.code}`;
        const cur = counted.get(key);
        if (cur) cur.count += 1;
        else counted.set(key, { code: f.code, level: f.level, count: 1 });
      }
      ruleSetLock = {
        lockable: assessment.allowed,
        requiresAcknowledgement: assessment.requiresAcknowledgement,
        blockerCount: assessment.findings.filter((f) => f.level === 'INVALID' || f.level === 'LOCK_BLOCKER')
          .length,
        warningCount: assessment.findings.filter((f) => f.level === 'LOCK_WARNING').length,
        findings: [...counted.values()],
      };
    }

    const [snapshot] =
      ruleSet && ruleSet.status === 'ACTIVE'
        ? await this.db.query<{ id: string; entry_count: number; created_at: string }>(
            `select id, entry_count, created_at from intake_snapshot
             where tournament_id = $1 and rule_set_id = $2 order by created_at desc limit 1`,
            [tournamentId, ruleSet.id],
          )
        : [undefined];

    const byEligibility = await this.db.query<{ status: EligibilityStatus; n: string }>(
      `select eligibility_status as status, count(*) as n from entry where tournament_id = $1 group by eligibility_status`,
      [tournamentId],
    );
    let total = 0;
    let eligible = 0;
    for (const r of byEligibility) {
      const n = Number(r.n);
      total += n;
      if (isPlaceable(r.status)) eligible += n;
    }

    const bySeverity = await this.db.query<{ severity: string; n: string }>(
      `select severity, count(*) as n from validation_issue where tournament_id = $1 and status = 'OPEN' group by severity`,
      [tournamentId],
    );
    const open = (s: string) => Number(bySeverity.find((r) => r.severity === s)?.n ?? 0);

    const blockers: string[] = [];
    if (ruleSet?.status !== 'ACTIVE') blockers.push('NO_ACTIVE_RULE_SET');
    else if (!snapshot) blockers.push('NO_INTAKE_SNAPSHOT');

    return {
      tournament,
      role: actor.role,
      // Mirrors POST /tournaments/:id/draw-runs (VIEWER is refused); the POST remains authoritative.
      canRequest: actor.role !== 'VIEWER',
      ruleSet: ruleSet
        ? {
            id: ruleSet.id,
            code: ruleSet.code,
            version: ruleSet.version,
            name: ruleSet.name,
            status: ruleSet.status,
          }
        : null,
      ruleSetLock,
      intakeSnapshot: snapshot
        ? { id: snapshot.id, entryCount: snapshot.entry_count, createdAt: snapshot.created_at }
        : null,
      entries: { total, eligible, blocked: total - eligible },
      openIssues: { error: open('ERROR'), warning: open('WARNING'), info: open('INFO') },
      blockers,
    };
  }
}
