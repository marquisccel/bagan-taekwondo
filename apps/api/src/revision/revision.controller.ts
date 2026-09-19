import { applyDrawCommand, type CommandOutcome, type Db } from '@bagantkd/db';
import type { DrawCommand } from '@bagantkd/domain';
import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';

import type { Actor } from '../auth/actor';
import { ActorGuard } from '../auth/actor.guard';
import { CurrentActor } from '../auth/current-actor.decorator';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import { body, num, numOrNull, str, strOrNull } from '../validation';

/**
 * POST /revisions/:id/commands/{move-entry,swap-entry,move-pool,regenerate-pool} and
 * POST /revisions/:id/{submit-review,approve,lock,publish,amend} (Phase 4 §14). Every command's
 * authorization, concurrency and idempotency rules live in `applyDrawCommand`
 * (packages/db/command-repository.ts) — this controller only shapes the HTTP body into a
 * `DrawCommand` and maps a REJECTED outcome onto the stable error contract (§15).
 */
@Controller('revisions/:id')
@UseGuards(ActorGuard)
@TournamentScope('revision', 'id')
export class RevisionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private common(b: Record<string, unknown>, revisionId: string) {
    return {
      revisionId,
      expectedLockVersion: num(b, 'expectedLockVersion'),
      idempotencyKey: str(b, 'idempotencyKey'),
      reason: strOrNull(b, 'reason'),
      complaintId: strOrNull(b, 'complaintId'),
    };
  }

  private async run(cmd: DrawCommand, actor: Actor): Promise<CommandOutcome> {
    const outcome = await applyDrawCommand(this.db, cmd, { userId: actor.userId, role: actor.role });
    if (outcome.outcome === 'REJECTED' && outcome.rejectionCode)
      throw new ApiError(
        outcome.rejectionCode,
        outcome.verdict.level === 'RED' ? outcome.verdict.hardViolations.join('; ') : outcome.rejectionCode,
        // The verdict (with its machine-readable violation codes and quality impact) travels with a
        // refusal so the client can explain it — it never computes one itself.
        { verdict: outcome.verdict },
      );
    return outcome;
  }

  @Post('commands/move-entry')
  async moveEntry(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    const b = body(raw);
    return this.run(
      {
        type: 'MOVE_ENTRY',
        ...this.common(b, id),
        entryId: str(b, 'entryId'),
        toPoolUid: str(b, 'toPoolUid'),
        toSlot: numOrNull(b, 'toSlot'),
      },
      actor,
    );
  }

  @Post('commands/swap-entry')
  async swapEntry(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    const b = body(raw);
    return this.run(
      { type: 'SWAP_ENTRIES', ...this.common(b, id), entryA: str(b, 'entryA'), entryB: str(b, 'entryB') },
      actor,
    );
  }

  @Post('commands/move-pool')
  async movePool(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    const b = body(raw);
    return this.run(
      {
        type: 'MOVE_POOL',
        ...this.common(b, id),
        poolUid: str(b, 'poolUid'),
        toArenaCode: str(b, 'toArenaCode'),
        toOrder: num(b, 'toOrder'),
      },
      actor,
    );
  }

  @Post('commands/regenerate-pool')
  async regeneratePool(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    const b = body(raw);
    return this.run({ type: 'REGENERATE_POOL', ...this.common(b, id), poolUid: str(b, 'poolUid') }, actor);
  }

  @Post('submit-review')
  async submitReview(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    return this.run({ type: 'LIFECYCLE', ...this.common(body(raw), id), action: 'SUBMIT' }, actor);
  }

  @Post('approve')
  async approve(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    return this.run({ type: 'LIFECYCLE', ...this.common(body(raw), id), action: 'APPROVE' }, actor);
  }

  @Post('lock')
  async lock(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    return this.run({ type: 'LIFECYCLE', ...this.common(body(raw), id), action: 'LOCK' }, actor);
  }

  @Post('publish')
  async publish(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    return this.run({ type: 'LIFECYCLE', ...this.common(body(raw), id), action: 'PUBLISH' }, actor);
  }

  @Post('amend')
  async amend(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<CommandOutcome> {
    return this.run({ type: 'LIFECYCLE', ...this.common(body(raw), id), action: 'AMEND' }, actor);
  }
}
