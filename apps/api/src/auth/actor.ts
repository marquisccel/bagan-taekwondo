import type { Role } from '@bagantkd/domain';

/**
 * The authenticated caller, resolved server-side (never trusted from client input). A full
 * login/session system is out of scope for Phase 4 (not part of the engineering brief's backend
 * scope, and building one would be a Phase 5+ feature) — the caller's identity is taken from the
 * `x-actor-id` header, which stands in for whatever upstream auth eventually sets it. What Phase 4
 * DOES guarantee is the non-negotiable part of §11: the ROLE is always looked up from
 * `tournament_member` for the tournament the request targets, never accepted from the client.
 */
export interface Actor {
  readonly userId: string;
  readonly role: Role;
  readonly tournamentId: string;
}
