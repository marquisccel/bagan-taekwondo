# ADR-0012: Safety invariants define correctness; the 2026 draw is a quality benchmark

- Status: Accepted (2026-09-11) — product-owner decision, supersedes PHASE0_PROPOSAL §3.4 wording

## Context

The Phase 0 proposal said the engine "must match or beat the committee on every metric". That
conflates two different things: whether a draw is **correct** (safe to use) and whether it is
**good** (physically homogeneous, well mixed). The 2026 draw was made by hand from an older data
snapshot and includes rule exceptions; it is evidence of practice, not an optimum.

## Decision

- **Correctness** = the safety invariants INV-01 … INV-08 (`packages/draw-engine/src/invariants.ts`,
  `docs/ACCEPTANCE_CRITERIA.md` §2). They must hold for **every** seed, dataset and revision.
  Any violation fails the build and makes a run `UNSAFE`.
- **Quality** = metrics compared with `fixtures/baselines/committee-2026.json`
  (`kind: HISTORICAL_QUALITY_BENCHMARK`). A worse metric is reported and reviewed; it never makes
  a correct draw fail, and a better metric never excuses an invariant violation.
- Optimization targets the **configured rules**, not resemblance to 2026. The engine is never
  tuned to reproduce the committee's specific pools.
- The draw simulator (`tools/draw-simulator`) is the first-class harness for both: it reports a
  safety verdict and, separately, a quality comparison, over a golden seed and many seeds.

## Consequences

- Acceptance has two independent gates with different failure semantics (§5 of
  ACCEPTANCE_CRITERIA).
- Claims are scoped: for n ≤ 8, bracket placement is "an exhaustive evaluation over the defined
  bracket-position search space under the configured objective and constraints" — nothing more.

## Enforced by

- `SimulationReport.safety` contains only invariant, refusal and replay results; baseline
  comparisons live in `SimulationReport.baseline` with a fixed "not a correctness criterion" note.
- Simulator CLI exit code depends on safety only.
