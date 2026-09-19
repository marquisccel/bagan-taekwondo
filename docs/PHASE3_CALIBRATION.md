# Phase 3 — algorithmic decisions and calibration

Records only decisions that are algorithmic, measured tradeoffs, or non-obvious invariants.
Numbers are from the 2026 data (REAL_2026, golden seed 20260827) unless stated otherwise.

## 1. Objective as implemented (ADR-0008)

- **Tier 0** (infeasible): pool size > `poolMax`, a missing measurement on an active dimension,
  a range above a `SET` maximum tolerance, belt `HARD` band mismatch. `UNSET`/`NONE` maxima add
  nothing.
- **Tier 1**: `Σ_dims floor(FP·(a·x + b·max(0, x−1)²)) + sizePenalty[|pool|]`, `x = range/ideal`,
  `a`, `b` = the tolerance's linear/overflow per-mille slopes. Weight > height > belt priority is
  the order of `tolerances` in the rule set (tie-breaks, `BALANCED` ordering); cost magnitudes
  come only from the slopes.
- **Tier 2**: `bracketWeight × minSameContingentRound1 + contingentWeight × max(0, cmax − ⌈k/2⌉)`.
  `minSameContingentRound1 = max(0, max(0, cmax − byes) − realMatches)` is the exact minimum over
  every bye assignment and pairing (property-tested against brute force).
- **Non-obvious invariants**
  - A per-dimension deviation saturates at 2^40 FP. Costs stay exact safe integers; a 2^53
    overflow was found by a property test.
  - The Tier-1 slack is a **budget per category**, not per change.
  - Tier 2 may never create a singleton (`SINGLETON_CREATION`): a walkover is never the price of
    contingent diversity. Without this rule, a large slack raised walkovers from 17 to 33.
  - The seed only breaks ties between entries with identical sort keys. Quality metrics were
    identical across the golden seed and the 20 robustness seeds.

## 2. Search

- Each strategy runs the same three steps:
  1. an exact DP over contiguous partitions of its own ordering;
  2. Tier-1 local search:
     - move and swap;
     - exact re-optimization of any two pools, including an empty one (split and merge);
     - dissolving pools of ≤ 2;
  3. Tier-2 local search with move and swap only.
- The scan is first-improvement and circular: it continues from the last accepted position. The
  budget is `localSearchBudgetPerEntry × n` evaluations per phase.
- Selection: lowest `(tier0, tier1, tier2)`, then strategy order. All five candidates are kept.

| Change (measured on the exhaustive and real-data probes)                         | Effect                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bug: a swap was skipped whenever the target pool was full                        | Fixed. Kyorugi single-contingent pools fell from 25 to 18                                        |
| Pair re-optimization + dissolve                                                  | Random 3-D categories n ≤ 10: Tier-1 gaps fell from 11/400 (max 36%) to 8/400 (max 11.6%)        |
| Three-pool rotation                                                              | No gap closed, time ×3. Removed                                                                  |
| Circular scan (restart from the last change, not from pool 0)                    | Budget exhaustion reduced; height within 5 cm 75.4% → 77.2%; runtime −10%                        |
| Exact integer deviation without BigInt on the hot path                           | Full 2026 draw 5.4 s → 1.7 s                                                                     |
| Saturation cap first built with a BigInt and closures per call (found by timing) | Regression to 8.7 s per READY-scope run; hoisted constants → 2.4 s, output fingerprint unchanged |

**Exhaustive comparison (n ≤ 10)**

- REAL_2026: 58 pooled categories, Tier-1 gap 0 in every one. In 4 of them Tier 2 spent
  6 000–46 400 FP of the 50 000 slack to remove one same-contingent meeting each.
- 400 random 3-D Kyorugi categories: 8 Tier-1 gaps, the largest 11.6%. These cases need a
  simultaneous exchange across three pools, which the heuristic does not search. Poomsae (one
  active dimension): 0 gaps.
- No global optimality is claimed.

## 3. Brackets

- `S = nextPowerOfTwo(max(2, n))`, `byes = S − n`. Standard seeding places ranks; the ranks above
  `n` are byes, so byes face the top ranks and a bye never meets a bye.
- Manual seeds keep their rank (INV-08). Every bye carries a reason.
- Contingent separation minimizes same-contingent meetings **lexicographically by round**
  (round 1 first). Pool composition is never changed to improve placement.
- For ≤ 8 unseeded entries, placement is exhaustive over one explicit search space: every
  assignment of the unseeded entries to the free ranks, with byes fixed. It equals an independent
  brute force in the tests.
- For more entries: greedy by rank, then first-improvement swaps. On n ≤ 8 this heuristic matched
  the exhaustive result in 120/120 cases. No claim is made beyond the enumerated space.

## 4. Pool-size and slack calibration (rule-set values, ENGINEERING_DEFAULT)

Semi-prestasi entries of all categories (2,375), golden seed. The committee column is the
benchmark (ADR-0012), not a target.

| Setting                                                         | Pool sizes 1/2/3/4 | singletonPools | kyorugi.pctPoolsHeightWithin5cm | kyorugi.heightRangeP90Cm | kyorugi.pctPoolsWeightWithin3kg | kyorugi.singleContingentPools | kyorugi.round1SameContingentPct | poomsae.pctPoolsHeightWithin5cm | poomsae.singleContingentPools | poomsae.round1SameContingentPct |
| --------------------------------------------------------------- | ------------------ | -------------- | ------------------------------- | ------------------------ | ------------------------------- | ----------------------------- | ------------------------------- | ------------------------------- | ----------------------------- | ------------------------------- |
| Committee 2026                                                  | 25/75/161/433      | 25             | 45.3                            | 14                       | 79.6                            | 14                            | 4.9                             | 68.3                            | 6                             | 5.8                             |
| placeholder (40k/10k/2.5k, slack 500) [SAFE, 2375 semi entries] | 62/141/333/258     | 62             | 89                              | 6                        | 90.4                            | 46                            | 10.1                            | 88.7                            | 8                             | 8                               |
| 200k/30k/5k, slack 500 [SAFE, 2375 semi entries]                | 21/63/292/338      | 21             | 79.5                            | 7                        | 86.3                            | 33                            | 9.1                             | 81.5                            | 6                             | 7                               |
| CHOSEN 400k/50k/10k, slack 50k [SAFE, 2375 semi entries]        | 17/50/250/377      | 17             | 76.8                            | 7                        | 85.5                            | 20                            | 5.1                             | 78.8                            | 5                             | 4.9                             |
| 400k/50k/10k, slack 200k [SAFE, 2375 semi entries]              | 17/52/254/373      | 17             | 76.9                            | 7                        | 85.5                            | 19                            | 4.5                             | 79.5                            | 6                             | 5.3                             |
| 400k/80k/15k, slack 100k [SAFE, 2375 semi entries]              | 17/34/234/397      | 17             | 76.1                            | 8                        | 84                              | 18                            | 4.6                             | 78.6                            | 5                             | 5                               |

Chosen: size penalties 1/2/3/4 = 400 000 / 50 000 / 10 000 / 0 FP and Tier-1 slack = 50 000 FP.
This leaves 17 walkovers (16 are forced by categories of one entry). Physical similarity stays far
above the committee; contingent diversity roughly matches it. A larger slack buys little and
starts to cost physical similarity. These are tradeoffs for the committee to confirm, not rules.

## 5. Not implemented in Phase 3

- `PERFORMANCE_ORDER` (freestyle). Its 6 categories are refused with
  `DRAW_FORMAT_NOT_IMPLEMENTED`; a READY-scope draw excludes them.
- Public match codes. `allocateMatchCodes` assigns stable `matchUid`s only; codes need arenas and
  a schedule (ADR-0005, Phase 4).

## 6. Tier 3 — contingent spread (AUD-004, engine 0.3.0)

Requirement (pre-UAT audit `docs/audit/SEMI_PRESTASI_REQUIREMENT_AUDIT.md`, AUD-004): contingent
separation stays **soft**, but when a dominant contingent cannot be avoided the engine must prefer
spreading the outsiders across pools (`A=6, B=1, C=1` → `AAAB` + `AAAC`, not `AAAA` + `AABC`). Tier 2
sums per-pool costs, so both layouts cost the same and the choice was arbitrary.

- **Definition.** `spread(pool) = Σ_contingents (members of that contingent in the pool)²`. Lower is
  more spread out. It never appears in Tier 0 and never blocks a draw.
- **Where it acts.** After the Tier-2 phase every strategy runs a third local-search phase
  (`localSearch(..., 'tier3')`, move and swap only). A change is accepted only if the total spread
  strictly decreases **and** Tier 0, Tier 1 and Tier 2 do not increase, no singleton is created, no
  pool leaves its ideal tolerance, and **no weight, height or belt range grows in total** — also for a
  dimension the rule set switched off (Poomsae weight, Q5), so the tie-break never quietly worsens a
  grouping the committee may later re-enable. It never spends Tier-1 slack. Rejections are counted per
  reason (`NO_TIER3_GAIN`, `TIER_REGRESSION`, plus the existing `IDEAL_REGRESSION` and
  `SINGLETON_CREATION`).
- **Ranking.** `rankCandidates` compares `(tier0, tier1, tier2)`, then the spread, then the strategy
  order. `decidedOn` of a beaten candidate can now be `TIER3_CONTINGENT_SPREAD`.
- **Explanation.** Each pool of a multi-contingent pooled category carries `POOL_CONTINGENT_MIX`
  (`size`, `distinctContingents`, `largestGroup`, `spread`); `CANDIDATE_SELECTED` and the candidate
  metrics carry `contingentSpread`; the selection rule string is
  `LOWEST_TIER0_TIER1_TIER2_TIER3_THEN_STRATEGY_ORDER`.
- **Version.** Output for the same input changes, so `ENGINE_VERSION` 0.2.0 → **0.3.0**. The 0.2.0
  golden fingerprint stays recorded for history.

### REAL_2026 effect (golden seed 20260827, READY scope, 201 categories, 122 pooled)

|                                                       | 0.2.0                    | 0.3.0                                 |
| ----------------------------------------------------- | ------------------------ | ------------------------------------- |
| output fingerprint                                    | `sha256:e9f8d118…45ed`   | `sha256:9625825c…e5f2`                |
| categories with a different pool composition          | —                        | **10 of 201** (all pooled)            |
| Σ Tier 0 / Tier 1 / Tier 2 of the selected candidates | 0 / 24 100 000 / 860 000 | 0 / 24 094 000 / 860 000              |
| categories worse on any of Tier 0/1/2                 | —                        | **0** (120 equal, 2 better on Tier 1) |
| walkovers, byes, real matches, pools                  | 24, 554, 1 994, 660      | unchanged                             |

Affected categories and why. In each, pool members were exchanged between two or more pools (pool-size
multisets unchanged), the total contingent spread strictly decreased, Tier 0/1/2 did not worsen, and no
category's weight/height ranges grew — except the last one, explained below:

- Kyorugi semi-prestasi (6): CADET FEMALE −41 (2 pools changed) and −44 (2); PRA_CADET_B MALE −20 (2), −22 (2),
  −28 (2); PRA_CADET_C MALE −48 (2). Height and weight ranges equal or better in each (−48: total height
  range 320 → 310 mm).
- Poomsae semi-prestasi (4): CADET FEMALE Taegeuk 3 (2 pools); JUNIOR FEMALE Taegeuk 1 (5) and Taegeuk 3 (4);
  PRA_CADET_B MALE Taegeuk 1 (4). The first three have equal or better height and weight ranges. **PRA_CADET_B
  MALE Taegeuk 1** changed for a different reason: its WEIGHT_FIRST candidate, after the Tier-3 phase, ties the
  other candidates on Tier 0/1/2 **and** spread (32), and wins on strategy order (the pre-existing final
  tie-break). Its (switched-off) weight ranges total 31 → 33 kg; height is unchanged.

Poomsae weight is switched off by the committee decision Q5 (AUD-001, unchanged), so its benchmark
metrics are informational: over all 128 measured Poomsae pools the sum of weight ranges went 1 791 → 1 776 kg,
while the share of pools within 3 kg / 5 kg went 10.9 % / 18.8 % → 10.2 % / 18.0 % (one pool each, from the
category above). Every other Gate B metric is identical to 0.2.0.

Gate A (21 seeds SAFE, INV-02/03/04/08), deterministic replay ×100 (one fingerprint, equal to the
recorded one), the exhaustive pooling comparison (58 categories ≤ 10 entries, Tier-1 gap 0) and the
committee benchmark (Gate B) were re-run for 0.3.0 — see `docs/PHASE3_GATE_REPORT.md` §7.
