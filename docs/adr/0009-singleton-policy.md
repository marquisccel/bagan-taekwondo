# ADR-0009: Singletons are walkovers with merge suggestions, never merged automatically

- Status: Accepted (2026-09-11) — committee answer Q4, provisional

## Context

The 2026 draw had 25 singleton semi-prestasi pools, each printed as a walkover with its own match
number (F-31). In a few cases the committee merged an athlete into an adjacent weight class or
gender (F-35, F-38). Merging changes an athlete's category — an eligibility decision.

## Decision

- Default `singleton.policy = WALKOVER_WITH_SUGGESTIONS`: the engine first tries every feasible
  move/swap within the category that absorbs the singleton. If none exists, the entry becomes a
  walkover pool (it still consumes a public match code).
- The engine attaches **ranked merge suggestions** (adjacent class, resulting ranges, contingent
  effect) to the explanation. It never applies one.
- A merge is a `REMOVE_ENTRY (CATEGORY_CHANGE)` + `ADD_ENTRY` command pair with a reason, subject
  to the normal YELLOW/RED rules and audit.
- Alternative policy `BLOCK_CATEGORY` makes the category `BLOCKED` until the operator decides.

## Consequences

- No athlete changes category without a person deciding and the audit trail recording it.
- Walkover count is reported as a quality metric, compared with the 2026 benchmark (25).

## Enforced by

Rule-set enum `SINGLETON_POLICIES`; the engine has no code path that changes an entry's category
(Phase 3 test: category membership before and after a draw is identical for every entry).
