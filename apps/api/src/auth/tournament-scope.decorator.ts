import { SetMetadata } from '@nestjs/common';

/** How to resolve the tournament a route is scoped to, from its own route params. */
export type ScopeKind = 'tournament' | 'draw-run' | 'revision' | 'export';

export const TOURNAMENT_SCOPE_KEY = 'tournamentScope';

/** Declares which route param identifies the tournament (directly, or via a draw-run/revision id). */
export const TournamentScope = (kind: ScopeKind, param = 'id'): MethodDecorator & ClassDecorator =>
  SetMetadata(TOURNAMENT_SCOPE_KEY, { kind, param });
