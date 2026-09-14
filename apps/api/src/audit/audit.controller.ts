import type { Db } from '@bagantkd/db';
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

const MAX_LIMIT = 200;

/** GET /tournaments/:id/audit (Phase 4 §14) — any tournament member (VIEWER included) can read it. */
@Controller('tournaments/:id/audit')
@UseGuards(ActorGuard)
@TournamentScope('tournament', 'id')
export class AuditController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(
    @Param('id') tournamentId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
  ): Promise<{ events: readonly Record<string, unknown>[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(Number(limitRaw ?? '50') || 50, 1), MAX_LIMIT);
    let before: number | null = null;
    if (beforeRaw !== undefined) {
      before = Number(beforeRaw);
      if (!Number.isInteger(before))
        throw new ApiError('VALIDATION_ERROR', 'before must be an integer cursor');
    }
    const rows = await this.db.query<Record<string, unknown> & { seq: number }>(
      before === null
        ? `select seq, id, occurred_at, actor_kind, actor_id, action, subject_type, subject_id, before, after, reason, complaint_id, command_id, hash, prev_hash
           from audit_event where tournament_id = $1 order by seq desc limit $2`
        : `select seq, id, occurred_at, actor_kind, actor_id, action, subject_type, subject_id, before, after, reason, complaint_id, command_id, hash, prev_hash
           from audit_event where tournament_id = $1 and seq < $3 order by seq desc limit $2`,
      before === null ? [tournamentId, limit] : [tournamentId, limit, before],
    );
    const last = rows[rows.length - 1];
    return { events: rows, nextCursor: rows.length === limit && last ? String(last.seq) : null };
  }
}
