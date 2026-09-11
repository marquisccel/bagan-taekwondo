# ADR-0007: Ideal versus maximum tolerance; an unset maximum blocks LOCK only

- Status: Accepted (2026-09-11)

## Context

The requirement states height ≈ 5 cm and weight ≈ 5 kg, adjustable per age class. The 2026
committee met 5 cm in only 45% of Kyorugi semi-prestasi pools (p90 height range 14 cm, F-34).
Treating 5 cm as a hard limit would fragment categories into singletons; filling a hard limit
from the 2026 p90 would be inventing a rule the committee never made.

## Decision

Every tolerance dimension (WEIGHT g, HEIGHT mm, BELT ranks) of a pool policy has:

- an **ideal** — drives the cost function (gentle slope inside, steep quadratic penalty beyond);
- a **maximum** with three states:
  - `UNSET` — not decided; no hard physical limit is applied;
  - `NONE` — the committee explicitly decided there is no hard limit;
  - `SET(value, provenance)` — hard limit; a pool beyond it is infeasible (Tier 0).

Readiness is purpose-specific (`packages/rules/src/readiness.ts`):

| Purpose            | Allowed with an active dimension whose max is `UNSET`?                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `SIMULATION`       | Yes. What-if maxima may be passed as **assumptions**, recorded in the report, never written to the rule set. |
| `CANDIDATE`        | Yes, without assumptions (a candidate carrying assumptions is refused).                                      |
| `LOCK` / `PUBLISH` | **No** — `MAX_TOLERANCE_UNSET` is a lock blocker.                                                            |

Values can differ per age division (`ageDivisionCode` override), and each carries provenance
(`COMMITTEE`, `STAKEHOLDER`, `EVIDENCE_2026`, `ENGINEERING_DEFAULT`, `TBD`).

Provisional 2026 values: ideal 5 kg / 5 cm (STAKEHOLDER), Kyorugi belt ideal 2 ranks
(ENGINEERING_DEFAULT), all maxima `UNSET`.

## Consequences

- The engine can be developed, calibrated and compared today; nothing official can be produced
  until the committee decides.
- The simulator can show the effect of candidate maxima (e.g. 10, 12, 14 cm) side by side, which
  gives the committee evidence to decide with.

## Alternatives rejected

- Hard 5 cm — contradicts evidence; many avoidable singletons.
- Auto-filling max from the 2026 p90 — invents a rule; rejected by the product owner.

## Enforced by

- Rule-set tests: provisional set allowed for SIMULATION/CANDIDATE, refused for LOCK with exactly
  four `MAX_TOLERANCE_UNSET` blockers; assessment never fills a value.
- DB checks `rule_tolerance_max_value_ck`, `rule_tolerance_max_ge_ideal_ck`,
  `rule_tolerance_max_provenance_ck`, `draw_run_candidate_no_assumptions_ck`.
- Engine test: assumptions on a CANDIDATE → `ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE`.
