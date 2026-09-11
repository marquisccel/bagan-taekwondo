# ADR-0004: Revision storage — copy-on-write snapshots plus an append-only command log

- Status: Accepted (2026-09-11)

## Context

A draw is never silently mutated. Every manual change (move, swap, regenerate, withdraw) must
produce a new revision, keep the previous one queryable and printable, record who/what/why, and
survive concurrent editing by two operators.

## Decision

- `draw_run` is immutable once finished (trigger `draw_run_guard`).
- A `draw_revision` owns its own rows in `pool`, `pool_member`, `bracket`, `bracket_slot`,
  `match` (**copy-on-write**). Revisions are never deleted.
- Every change is a **domain command** (`packages/domain/src/commands.ts`) stored in the
  append-only `draw_command` table, applied or rejected, with its verdict and reason.
- **Lifecycle**: `DRAFT → REVIEW → APPROVED → LOCKED → PUBLISHED`, `PUBLISHED → AMENDED` when an
  amendment starts, `AMENDED → SUPERSEDED` when it is published or back to `PUBLISHED` if
  abandoned. Only `DRAFT` accepts draw commands; content is frozen from `REVIEW` onward.
- **Optimistic concurrency**: every update of a revision must increment `lock_version` by exactly
  one; commands carry the version they saw and fail with `REVISION_CONFLICT` otherwise.
- **Idempotency**: `(tournament_id, idempotency_key)` is unique; a replayed command returns the
  original outcome.
- **Official result**: `official_category_assignment` has one row per category pointing at a
  `PUBLISHED` revision.

## Consequences

- Any revision can be printed, diffed or restored without replaying history.
- Storage per revision ≈ entries + matches (≈ 8k rows at 5,000 entries); hundreds of revisions
  stay small.
- Pool and match identities (`pool_uid`, `match_uid`) persist across revisions, which is what
  makes public match codes stable (ADR-0005).

## Alternatives rejected

- **Event sourcing only** — every read would replay commands; one buggy projection changes history.
- **In-place updates with a history table** — the official printed state could be overwritten.

## Enforced by

- Triggers `draw_revision_guard`, `revision_content_guard`, `official_category_assignment_guard`,
  `draw_command_append_only`, `draw_run_guard`.
- Unique `pool_member_once_per_revision_uq` (INV-02).
- Tests: lifecycle parity SQL↔TypeScript; frozen content; lock_version; official assignment;
  property tests `packages/domain/src/state-machines.property.test.ts`.
