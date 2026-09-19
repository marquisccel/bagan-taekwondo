import { SetMetadata } from '@nestjs/common';

/** How to resolve the tournament a route is scoped to, from its own route params. */
export type ScopeKind = 'tournament' | 'draw-run' | 'revision' | 'export' | 'actor';

export const TOURNAMENT_SCOPE_KEY = 'tournamentScope';

/** Declares which route param identifies the tournament (directly, or via a draw-run/revision id). */
export const TournamentScope = (kind: ScopeKind, param = 'id'): MethodDecorator & ClassDecorator =>
  SetMetadata(TOURNAMENT_SCOPE_KEY, { kind, param });

/**
 * For collection routes that are not scoped to ONE tournament (e.g. `GET /tournaments`): the guard
 * only requires an identified actor (`x-actor-id`); the handler itself must then restrict every
 * row it returns to tournaments the actor is a member of (see `CurrentActorId`).
 */
export const ActorScope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TOURNAMENT_SCOPE_KEY, { kind: 'actor' satisfies ScopeKind, param: '' });
