# ADR-0008: Multi-tier pooling objective; every strategy candidate is retained

- Status: Accepted (2026-09-11)

## Context

Semi-prestasi pooling trades several goals: physical similarity, useful pool sizes, bracket
fairness and contingent diversity. The product owner fixed the priority: hard eligibility >
physical fairness > bracket fairness > contingent diversity. A plain weighted sum would let a
large contingent term buy a worse physical grouping; a strict lexicographic order would make
contingent diversity a mere tie-breaker.

## Decision

**Tier 0 — hard eligibility (infeasible if violated):** category partition, hard belt/movement
policy, pool size ≤ `pool_max`, any range above a `SET` maximum tolerance.

**Tier 1 — physical similarity + pool size:** for each active dimension,
`dev = a·x + b·max(0, x − 1)²` with `x = range / ideal`, plus `size_penalty[|pool|]`.

**Tier 2 — bracket fairness + contingent diversity:** exact minimum same-contingent round-1
meetings over the pool's legal pairings, plus the largest-contingent-share excess.

**No-regression rule.** A change that improves Tier 2 is accepted only if
(a) no affected pool moves from inside its ideal tolerance to outside it, and
(b) the Tier-1 increase is at most `tier1SlackFp`.
(`forbidIdealRegression` is fixed to `true` in the schema; the slack is configurable.)

**Candidates.** Five deterministic strategies — `WEIGHT_FIRST`, `HEIGHT_FIRST`, `BELT_FIRST`,
`BALANCED`, `CONTINGENT_AWARE` — each produce a full partition (exact DP over its 1-D ordering,
then seeded local search, then repair). The lowest `(tier0, tier1, tier2)` wins; ties break by
strategy order. **All five results are stored** (`pool_candidate`) with rank, costs, partition and
metrics; exactly one is selected, and a selected candidate can never have Tier-0 violations.

No claim of global optimality is made: DP is optimal only for contiguous partitions of one
ordering. Quality is measured against the committee benchmark and, in tests, against exhaustive
search on small categories (ADR-0012).

## Consequences

- Operators and complaint reviewers can see why the chosen partition beat the alternatives.
- What-if analysis can switch strategy without re-running the engine.
- All weights, slacks and size penalties are rule-set values with provenance; current values are
  `ENGINEERING_DEFAULT` placeholders to be calibrated in Phase 3.

## Enforced by

- Schema: `pool_candidate` PK per strategy, `pool_candidate_one_selected_uq`,
  `pool_candidate_selected_valid_ck`; rule-set schema `forbidIdealRegression: true`.
- Phase 3: property tests that Tier-2 moves never break the no-regression rule; exhaustive
  comparison on categories of ≤ 10 entries.
