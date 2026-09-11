# ADR-0002: Job queue on PostgreSQL (pg-boss) instead of Redis + BullMQ

- Status: Accepted (2026-09-11) — approved deviation from the engineering brief

## Context

Draw runs, imports and exports run asynchronously. Load is low (a few jobs per hour; a draw of
5,000 entries is seconds of CPU) but correctness matters: a `draw_run` row without its job, or a
job without its row, leaves the operator with a run that never finishes or a result nobody asked
for. Venue deployments should run as few stateful services as possible.

## Decision

Use **pg-boss** (PostgreSQL-backed queue). The `draw_run` insert and the job enqueue happen in the
same database transaction. The queue sits behind a `JobQueue` port in the worker/API, so BullMQ
can replace it without touching domain code.

## Consequences

- No lost or orphaned jobs: enqueue commits or rolls back with the business row.
- One fewer service to install, back up and monitor at the venue.
- pg-boss creates its own schema (`pgboss`) at runtime; it is not part of the Drizzle migrations.
- Throughput is far below Redis, which is irrelevant at this load.

## Alternatives rejected

- **Redis + BullMQ** (brief default) — non-transactional with PostgreSQL (needs an outbox to be
  safe), an extra stateful service, no benefit at this load.
- **In-process execution** — a long draw or PDF render would block API requests; no retry.

## Enforced by

Phase 4 integration test: a failed transaction after enqueue leaves neither the job nor the run.
