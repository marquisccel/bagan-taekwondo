import type { Db } from '@bagantkd/db';
import type { Role } from '@bagantkd/domain';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import type { Actor } from './actor';
import { TOURNAMENT_SCOPE_KEY, type ScopeKind } from './tournament-scope.decorator';

interface RequestWithActor {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  actor?: Actor;
  actorId?: string;
}

/**
 * Resolves the caller's identity and role server-side, from `tournament_member` — never from
 * client input (Phase 4 §11). Every controller method touching a tournament-scoped resource must
 * carry `@TournamentScope(...)`; a route without it is refused rather than silently open.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<{ kind: ScopeKind; param: string } | undefined>(
      TOURNAMENT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) throw new ApiError('INTERNAL_ERROR', 'route is missing @TournamentScope');

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const userId = req.headers['x-actor-id'];
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new ApiError('UNAUTHORIZED_TOURNAMENT_ACCESS', 'x-actor-id header is required');
    }

    if (scope.kind === 'actor') {
      // Collection route (not scoped to one tournament): identity only, membership is enforced by the handler's query.
      req.actorId = userId;
      return true;
    }

    const routeValue = req.params[scope.param];
    if (!routeValue) throw new ApiError('INTERNAL_ERROR', `route param ${scope.param} is missing`);
    const tournamentId = await this.resolveTournamentId(scope.kind, routeValue);
    if (!tournamentId) throw new ApiError('TOURNAMENT_NOT_FOUND');

    const [member] = await this.db.query<{ role: Role }>(
      `select role from tournament_member where tournament_id = $1 and user_id = $2`,
      [tournamentId, userId],
    );
    if (!member)
      throw new ApiError('UNAUTHORIZED_TOURNAMENT_ACCESS', 'caller is not a member of this tournament');

    req.actor = { userId, role: member.role, tournamentId };
    return true;
  }

  private async resolveTournamentId(kind: ScopeKind, routeValue: string): Promise<string | null> {
    if (kind === 'tournament') return routeValue;
    if (kind === 'draw-run') {
      const [row] = await this.db.query<{ tournament_id: string }>(
        `select tournament_id from draw_run where id = $1`,
        [routeValue],
      );
      return row?.tournament_id ?? null;
    }
    if (kind === 'export') {
      const [row] = await this.db.query<{ tournament_id: string }>(
        `select tournament_id from export_artifact where id = $1`,
        [routeValue],
      );
      return row?.tournament_id ?? null;
    }
    const [row] = await this.db.query<{ tournament_id: string }>(
      `select tournament_id from draw_revision where id = $1`,
      [routeValue],
    );
    return row?.tournament_id ?? null;
  }
}
