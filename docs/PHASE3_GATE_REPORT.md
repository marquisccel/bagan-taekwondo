# Phase 3 gate report — draw engine

Status: **acceptance gate reached and production hardening complete (§6); Phase 4 not started; no
UI work.** Engine version `0.2.0`, contract frozen: [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md).
Algorithmic decisions and measured tradeoffs: [`PHASE3_CALIBRATION.md`](PHASE3_CALIBRATION.md).

## 1. Acceptance (Phase 3H)

| #   | Criterion                                      | Result                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gate A safety invariants on the golden seed    | ✅ REAL_2026, seed 20260827: SAFE; INV-02/03 0 violations; INV-04/08 self-checked for every bracket; 2,654 eligible entries of the 201 drawn categories each placed exactly once                                                                                    |
| 2   | Gate A on all 20 robustness seeds              | ✅ 21/21 SAFE, 0 violations (golden test and simulator). Every quality metric identical across seeds                                                                                                                                                                |
| 3   | Deterministic replay × 100                     | ✅ 100 golden-seed runs → one output fingerprint. Frozen 0.2.0 fingerprint `sha256:e9f8d118…45ed` (hardening added the `lock`/`failure`/`limits` envelope; the draw itself is bit-identical to the pre-hardening `sha256:dc90ca3f…c5177`, proven by reconstruction) |
| 4   | Exhaustive pooling comparison, categories ≤ 10 | ✅ REAL_2026: 58 categories, Tier-1 gap 0 in every one. Random 3-D categories: 8/400 gaps (max 11.6%), reported, not hidden. Poomsae: 0/400                                                                                                                         |
| 5   | Exhaustive bracket evaluation, n ≤ 8           | ✅ equals an independent brute force over the defined search space; the n > 8 heuristic matches it in 120/120 small cases                                                                                                                                           |
| 6   | All candidate strategies kept                  | ✅ 122/122 pooled categories keep all 5 candidates, each with costs, metrics, violations and explanations; exactly one selected, none with Tier-0 violations. **DB persistence of candidates: see U-P3-04**                                                         |
| 7   | Real 2026 data gives explainable results       | ✅ 660/660 pools have structured reasons; 554/554 byes have a reason; singleton walkovers carry merge suggestions (never applied); rejected local-search changes are counted per reason code                                                                        |
| 8   | SYNTHETIC_5K p95 < 30 s                        | ✅ every eligible entry drawn (4,777 entries): p95 **6.2 s** over 21 seeds. READY scope (3,405): p95 3.4 s                                                                                                                                                          |
| 9   | SYNTHETIC_10K completes                        | ✅ every eligible entry drawn (9,519 entries, 2,071 pools): **16.6 s**, SAFE                                                                                                                                                                                        |
| 10  | Maximum tolerances remain UNSET                | ✅ all 6 still `UNSET`; lock is still refused (4 × `MAX_TOLERANCE_UNSET`, 2 × `VALUE_TBD`, `RULE_SET_NOT_ACTIVE`). A `SET` maximum exists only as a SIMULATION assumption (tested)                                                                                  |
| 11  | No UI work                                     | ✅ none                                                                                                                                                                                                                                                             |

The engine also re-derives all 238 categories independently of the intake: 0 disagreements and
0 category-key mismatches. The 37 categories not drawn are refused, with reasons:

- 31 × `ENTRIES_WITHHELD` (`categoryReadiness` = `BLOCK_CATEGORY`, ENGINEERING_DEFAULT);
- 12 × `NO_ELIGIBLE_ENTRIES`, which overlap the previous reason;
- 6 × `DRAW_FORMAT_NOT_IMPLEMENTED` (freestyle).

## 2. Test results

Unit 238 · property 36 · golden 17 · db 88 (PGlite 18.3 and PostgreSQL 16.15) — **379 passed, 0 failed**
(356 at the algorithm gate + 23 hardening tests).
`typecheck` ✅ · `lint` ✅ · `format:check` ✅. CI not run: it needs a push, which awaits approval.

## 3. Quality benchmark vs the 2026 committee draw (golden seed, READY scope)

Benchmark, not correctness (ADR-0012). The committee drew every semi-prestasi athlete; this draw
excludes the 31 categories that hold withheld entries. The all-eligible comparison
(`DRAW_ELIGIBLE_ONLY` what-if, 2,375 entries) is in `PHASE3_CALIBRATION.md` §4 and leads to the
same conclusions.

| Metric                            | Committee | Engine | Status |
| --------------------------------- | --------- | ------ | ------ |
| singletonPools                    | 25 pools  | 17     | BETTER |
| kyorugi.poolsSizeAtLeast2         | 523 pools | 435    | INFO   |
| kyorugi.poolsWithoutDirtyRows     | 505 pools | 435    | INFO   |
| kyorugi.heightRangeMedianCm       | 6 cm      | 4      | BETTER |
| kyorugi.heightRangeP90Cm          | 14 cm     | 7      | BETTER |
| kyorugi.heightRangeMaxCm          | 36 cm     | 14     | BETTER |
| kyorugi.pctPoolsHeightWithin5cm   | 45.3 %    | 77.2   | BETTER |
| kyorugi.pctPoolsHeightWithin10cm  | 76.6 %    | 96.8   | BETTER |
| kyorugi.weightRangeMedianKg       | 2 kg      | 2      | EQUAL  |
| kyorugi.weightRangeP90Kg          | 5 kg      | 4      | BETTER |
| kyorugi.pctPoolsWeightWithin3kg   | 79.6 %    | 86.9   | BETTER |
| kyorugi.pctPoolsWeightWithin5kg   | 91.9 %    | 96.6   | BETTER |
| kyorugi.poolsCrossingMovementBand | 271 pools | 218    | BETTER |
| kyorugi.singleContingentPools     | 14 pools  | 14     | EQUAL  |
| kyorugi.round1SameContingentPct   | 4.9 %     | 4.8    | BETTER |
| poomsae.poolsSizeAtLeast2         | 147 pools | 129    | INFO   |
| poomsae.poolsWithoutDirtyRows     | 142 pools | 128    | INFO   |
| poomsae.heightRangeMedianCm       | 4 cm      | 3      | BETTER |
| poomsae.heightRangeP90Cm          | 10 cm     | 8.1    | BETTER |
| poomsae.heightRangeMaxCm          | 20 cm     | 20     | EQUAL  |
| poomsae.pctPoolsHeightWithin5cm   | 68.3 %    | 79.7   | BETTER |
| poomsae.pctPoolsHeightWithin10cm  | 93 %      | 95.3   | BETTER |
| poomsae.weightRangeMedianKg       | 8 kg      | 11.5   | WORSE  |
| poomsae.weightRangeP90Kg          | 21 kg     | 27.1   | WORSE  |
| poomsae.pctPoolsWeightWithin3kg   | 12.7 %    | 10.9   | WORSE  |
| poomsae.pctPoolsWeightWithin5kg   | 27.5 %    | 18.8   | WORSE  |
| poomsae.poolsCrossingMovementBand | 0 pools   | 0      | EQUAL  |
| poomsae.singleContingentPools     | 6 pools   | 4      | BETTER |
| poomsae.round1SameContingentPct   | 5.8 %     | 5.1    | BETTER |

**WORSE, explained:** all four are Poomsae weight metrics. Weight is **disabled** for Poomsae
semi-prestasi in the rule set (Q5, STAKEHOLDER), so the engine does not optimize it. ACCEPTANCE §3
already marks these metrics informational while weight is disabled. This is a rule difference, not
an engine weakness.

## 4. Unresolved decisions (for review before Phase 4)

| ID      | Decision                                                                                                                          | Current                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| U-P3-01 | Pool-size penalties 400k/50k/10k/0 and Tier-1 slack 50k (calibrated; tradeoff table in PHASE3_CALIBRATION §4)                     | ENGINEERING_DEFAULT — committee to confirm         |
| U-P3-02 | Freestyle `PERFORMANCE_ORDER` draw format                                                                                         | not implemented; 6 categories refused              |
| U-P3-03 | Public match codes (ADR-0005) need arenas and a schedule                                                                          | stable `matchUid` only; codes in Phase 4           |
| U-P3-04 | Storing candidates, pools and brackets in the database needs `category` rows, i.e. relational rule-set persistence (Phase 2 U-11) | kept in the engine output and simulator report     |
| U-P3-05 | The Tier-1 heuristic misses the exhaustive optimum on 2% of random 3-D categories (≤ 11.6%); none on the 2026 data                | reported; a 3-pool exchange move is possible later |
| U-P3-06 | Semi-prestasi PAIR/TEAM pooling (no such template in 2026)                                                                        | refused with `POOLING_REQUIRES_INDIVIDUAL_FORMAT`  |
| —       | Phase 2 open items U-01…U-12, including max tolerances, official weight tables and heuristic group confirmation                   | unchanged                                          |

## 5. Files

- **New engine modules** (`packages/draw-engine/src`):
  - `pooling.ts`: cost, strategies, DP, local search;
  - `bracket.ts`: brackets, byes, seeds, contingent separation, INV-04/08 checker;
  - `draw.ts`: stages 5–14 and explanations;
  - `quality.ts`: benchmark metrics;
  - `exhaustive.ts`: reference enumeration.
- **New tests:** `pooling.property`, `bracket`, `bracket.property`, `draw`, `phase3.golden`.
- **Changed**
  - Engine: `contract.ts` (pool, bracket and candidate results; version 0.2.0), `run.ts` (all 14 stages, self-check, SIMULATION assumptions), and the Phase 2 engine tests whose "refuses at `buildPools`" expectation no longer applies.
  - Simulator: `simulate.ts` (READY scope plan, N-run replay, timings, explainability summary), `cli.ts` (`--scope`, `--replay`), `summary.ts`, and its tests.
  - Rule set: `categoryReadiness` policy and the Phase 3 calibration values, with provenance.
  - `fixtures/datasets/manifest.json`: engine fingerprint.
  - `vitest.config.ts`: hook timeouts for the golden and db tiers.
- **Docs:** `PHASE3_CALIBRATION.md` and this report.

## 6. Production hardening

| Item             | Result                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract         | One entry point `runDraw`; status `SAFE` / `UNSAFE` / `FAILED`; UNSAFE returns no pool or candidate; FAILED carries a stable code; `lock` states why a run cannot be locked. See `ENGINE_CONTRACT.md`                           |
| Failure taxonomy | 60+ stable codes in `src/codes.ts`; a test asserts that every emitted code is catalogued                                                                                                                                        |
| Resource guards  | 6 limits (entries, category size, bracket size, pool size, pools, work per candidate) → `RESOURCE_LIMIT_EXCEEDED`; a 2,000-entry category completes in about 5 s                                                                |
| Determinism      | Identical fingerprints in-process, in fresh processes and in a worker thread. Array order of the input is irrelevant (the input fingerprint is order-independent)                                                               |
| Coverage         | REAL_2026: 3,154 rows → 3,115 entries → 2,654 placed + 49 not eligible (with reasons) + 412 in blocked categories (with reasons). Fully accounted                                                                               |
| PII              | **3 real NIKs found in `normalize.test.ts` (written in Phase 2, never committed) and replaced** with synthetic region-99 values. Repository, git history, reports, CLI output and benchmark artifacts: 0 real NIK, 0 real names |
| Benchmarks       | `docs/reports/phase3-benchmarks/*.json` (schema-checked): REAL_2026 p95 1.6 s, SYNTHETIC_5K (4,777 entries) p95 4.5 s, SYNTHETIC_10K (9,519 entries) 12.7 s; all SAFE, retry identical                                          |
| Runbook          | `PHASE3_RUNBOOK.md`                                                                                                                                                                                                             |

**Defects found and fixed (each reproduced by a failing test first):**

1. Duplicate manual seed numbers were silently re-ranked. They are now `MANUAL_SEED_INVALID`.
2. A seed beyond the bracket size was silently moved. It is now `MANUAL_SEED_INVALID`.
3. Singleton policy `BLOCK_CATEGORY` was ignored. It is now `SINGLETON_POLICY_BLOCK`.
4. An UNSAFE run still returned the pools of its READY categories, which is a partial draw.
5. An exception could escape `runDraw`. It now returns `FAILED` with a code.
6. The input fingerprint depended on array order.
7. The exact two-pool search had no work bound. It now counts against `maxWorkPerCandidate`.

None of these fixes changes the draw for valid 2026, 5K or 10K inputs.
