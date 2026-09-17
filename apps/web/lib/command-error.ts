import { ApiClientError, type CommandOutcome } from './api';

/**
 * A command result, from the caller's point of view: either applied, or rejected with a code and
 * a human-readable message. The backend's command endpoints (apps/api/src/revision/revision.controller.ts)
 * map every REJECTED `CommandOutcome` onto a non-2xx HTTP status (`ApiError`), so a rejection
 * always reaches the client as a thrown `ApiClientError`, never as a resolved `{outcome:'REJECTED'}`
 * body — this normalizes both shapes into one so callers only need one branch.
 */
export type CommandResult =
  | { readonly ok: true; readonly outcome: CommandOutcome }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function runCommand(fn: () => Promise<CommandOutcome>): Promise<CommandResult> {
  try {
    const outcome = await fn();
    if (outcome.outcome === 'REJECTED' && outcome.rejectionCode) {
      const message =
        outcome.verdict.level === 'RED' ? outcome.verdict.hardViolations.join('; ') : outcome.rejectionCode;
      return { ok: false, code: outcome.rejectionCode, message };
    }
    return { ok: true, outcome };
  } catch (e: unknown) {
    if (e instanceof ApiClientError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'UNKNOWN_ERROR', message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/** A safe, operator-facing message for a rejection code — never the raw backend text for these. */
export function friendlyMessage(code: string, fallback: string): string {
  if (code === 'FORBIDDEN_COMMAND' || code === 'UNAUTHORIZED_TOURNAMENT_ACCESS')
    return 'You do not have permission to do this.';
  if (code === 'REVISION_LOCKED')
    return 'This revision is no longer editable (locked, published, or amended).';
  if (code === 'RULE_SET_NOT_READY') return fallback;
  return fallback;
}
