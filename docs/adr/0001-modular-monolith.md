# ADR-0001: Modular monolith in a TypeScript monorepo

- Status: Accepted (2026-09-11)
- Deciders: product owner, engineering

## Context

The system serves one tournament committee at a time, with a handful of concurrent operators and
bursts of CPU work (draw runs, PDF rendering). It must also run on a single laptop at a venue
with unreliable internet (Q-17). The heaviest correctness risks are in pure logic (pooling,
brackets, revisions), not in distributed coordination.

## Decision

One repository, one language (TypeScript, strict), one database (PostgreSQL 16):

```
apps/api        NestJS HTTP API (commands, queries, auth)             — Phase 4
apps/worker     background jobs: draw, import, export                  — Phase 4
apps/web        Next.js operator UI                                    — Phase 5
packages/shared      canonical JSON, fingerprints, seeded PRNG, fixed point, comparators
packages/domain      enums, units, state machines, issue catalog, commands (no I/O)
packages/rules       rule-set model, structural validation, readiness per purpose
packages/draw-engine pure deterministic engine contract and stages
packages/db          Drizzle schema, SQL migrations, invariant triggers
tools/draw-simulator replay / multi-seed / baseline harness (first-class, ADR-0012)
tools/source-analysis Phase 0 evidence scripts
```

Dependency direction: `apps → packages`, `db → rules → domain → shared`,
`draw-engine → rules/domain/shared`. The engine never depends on `db`, HTTP or the clock.

Deployment: Docker Compose runs PostgreSQL (Phase 1) and later the API, worker and web as three
processes of the same codebase — on a venue laptop or a server.

## Consequences

- Refactoring across module boundaries is a compiler-checked change, not a versioned API change.
- The same engine code runs in the worker, in the API (authoritative command validation) and in
  the browser (predictive GREEN/YELLOW/RED feedback), so the three can never disagree.
- Scaling is vertical plus more worker processes; this covers the 10,000-entry target.

## Alternatives rejected

- **Microservices** — operational cost with no benefit at this scale; distributed transactions
  would weaken the revision/audit guarantees.
- **Python engine + TypeScript app** — two languages, and the engine could not run in the browser
  for instant drag-and-drop feedback.

## Enforced by

- TypeScript project references (`tsconfig.build.json`) — a forbidden import fails the build.
- ESLint determinism rules on pure packages (ADR-0006).
