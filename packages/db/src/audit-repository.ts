import { fingerprint } from '@bagantkd/shared';

import type { SqlExecutor } from './intake-repository.js';

/**
 * Appends one event to the tamper-evident audit trail (ADR-0013). The hash chain itself (prev_hash
 * must equal the chain head; the head advances) is enforced by the `audit_event_chain_guard` /
 * `audit_event_chain_advance` triggers, which serialize concurrent appends to the same chain with
 * an advisory lock. This function computes the event's own hash so the chain is verifiable without
 * trusting the application again later (INV-07): `hash = fingerprint({...event, prevHash})`.
 *
 * A transaction that loses the race for the chain head raises `AUDIT_CHAIN_BROKEN`; the whole
 * command transaction is retried by the caller (see `withAuditRetry` in command-repository.ts).
 */
export interface AuditEventInput {
  readonly chainKey: string;
  readonly tournamentId: string | null;
  readonly actorKind: 'USER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly complaintId: string | null;
  readonly commandId: string | null;
  readonly correlationId: string | null;
}

export async function appendAuditEvent(
  tx: SqlExecutor,
  event: AuditEventInput,
): Promise<{ id: string; hash: string }> {
  const [head] = await tx.query<{ last_hash: string }>(
    `select last_hash from audit_chain_head where chain_key = $1`,
    [event.chainKey],
  );
  const prevHash = head?.last_hash ?? null;
  const occurredAt = new Date().toISOString();
  const hash = fingerprint({
    chainKey: event.chainKey,
    tournamentId: event.tournamentId,
    occurredAt,
    actorKind: event.actorKind,
    actorId: event.actorId,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    before: event.before,
    after: event.after,
    reason: event.reason,
    complaintId: event.complaintId,
    commandId: event.commandId,
    correlationId: event.correlationId,
    prevHash,
  });
  const [row] = await tx.query<{ id: string }>(
    `insert into audit_event (chain_key, tournament_id, occurred_at, actor_kind, actor_id, action, subject_type, subject_id, before, after, reason, complaint_id, command_id, correlation_id, prev_hash, hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16) returning id`,
    [
      event.chainKey,
      event.tournamentId,
      occurredAt,
      event.actorKind,
      event.actorId,
      event.action,
      event.subjectType,
      event.subjectId,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.reason,
      event.complaintId,
      event.commandId,
      event.correlationId,
      prevHash,
      hash,
    ],
  );
  return { id: row?.id ?? '', hash };
}

export const tournamentChainKey = (tournamentId: string): string => `tournament:${tournamentId}`;

/** True if the error is the chain-head race (`AUDIT_CHAIN_BROKEN`); the caller should retry. */
export function isAuditChainRace(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes('AUDIT_CHAIN_BROKEN');
}
