# Architecture Decision Records

Each ADR states the context, the decision, its consequences, the alternatives rejected, and —
where the decision is a rule — **how it is enforced** (test, constraint, trigger or lint rule).
A decision that cannot be enforced mechanically says so.

| ADR                                          | Decision                                                  | Status   |
| -------------------------------------------- | --------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)             | Modular monolith in a pnpm/TypeScript monorepo            | Accepted |
| [0002](0002-job-queue-pg-boss.md)            | pg-boss on PostgreSQL instead of Redis + BullMQ           | Accepted |
| [0003](0003-orm-drizzle.md)                  | Drizzle ORM with SQL migrations; invariants in SQL        | Accepted |
| [0004](0004-revision-storage.md)             | Copy-on-write revision snapshots + command log            | Accepted |
| [0005](0005-public-match-code-stability.md)  | Stable, never-reused public match codes                   | Accepted |
| [0006](0006-deterministic-engine.md)         | Deterministic, pure draw engine                           | Accepted |
| [0007](0007-tolerance-model.md)              | Ideal vs maximum tolerance; UNSET max blocks LOCK only    | Accepted |
| [0008](0008-pooling-objective-tiers.md)      | Multi-tier pooling objective; all candidates retained     | Accepted |
| [0009](0009-singleton-policy.md)             | Singleton = walkover + merge suggestions, never automatic | Accepted |
| [0010](0010-pair-team-grouping.md)           | Pair/team grouping provenance (EntryGroupSource)          | Accepted |
| [0011](0011-data-quality-override.md)        | Registration vs eligibility; explicit TD overrides        | Accepted |
| [0012](0012-correctness-vs-benchmark.md)     | Safety invariants define correctness; 2026 is a benchmark | Accepted |
| [0013](0013-audit-trail-integrity.md)        | Append-only, hash-chained audit trail                     | Accepted |
| [0014](0014-participant-identity-privacy.md) | Tournament-scoped identity; personal-data handling        | Accepted |
| [0015](0015-pinned-toolchain.md)             | Pinned toolchain versions, upgraded deliberately          | Accepted |
