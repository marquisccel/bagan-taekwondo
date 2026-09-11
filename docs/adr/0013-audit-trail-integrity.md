# ADR-0013: Append-only, hash-chained audit trail

- Status: Accepted (2026-09-11)

## Context

The audit trail must answer who, what, when, why, before, after and which complaint — and it
must be credible: an operator must not be able to rewrite or remove history.

## Decision

- `audit_event` is append-only: UPDATE, DELETE and TRUNCATE are rejected by triggers.
- Events form one **chain per tournament** (`chain_key = 'tournament:<id>'`, or `'global'`).
  Each event stores `prev_hash` and `hash = SHA-256(canonical JSON of the event)`.
- The insert trigger takes a per-chain advisory lock and rejects any event whose `prev_hash` is
  not the current head (`audit_chain_head`), so the chain is linear and cannot fork, even under
  concurrent writers.
- Hashes are computed by the application with the same canonical JSON as fingerprints; the INV-07
  checker recomputes them end to end (Phase 4).
- Actor is either a user (`actor_id` required) or the system.

## Consequences

- Removing or altering an event breaks the chain detectably; the database refuses both anyway.
- Audit writes are serialized per tournament; at this scale that is not a bottleneck.

## Enforced by

Triggers `audit_event_append_only`, `audit_event_no_truncate`, `audit_event_chain_guard`,
`audit_event_chain_advance`; checks `audit_event_actor_ck`, `audit_event_hash_ck`,
`audit_event_chain_key_ck`; tests for linear chain, fork rejection, append-only, chain-key
consistency.
