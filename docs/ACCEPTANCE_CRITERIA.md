# Acceptance Criteria

| | |
|---|---|
| Status | Accepted with Phase 1 (2026-09-11) |
| Governing decisions | ADR-0012 (correctness vs benchmark), ADR-0006 (determinism), ADR-0007 (tolerances) |

## 1. Two gates, different meanings

| Gate | Question | Failure means |
|---|---|---|
| **A. Safety invariants** | Is this draw correct and safe to use? | The run is `UNSAFE`, the build fails, nothing can be locked. No exceptions. |
| **B. Quality benchmark** | How good is it compared with the 2026 committee draw? | A reported finding that needs a written explanation. It never overrides A. |

The 2026 committee draw is **historical evidence, not ground truth**. The engine optimizes the
configured rules; it is never tuned to reproduce the committee's pools.

## 2. Gate A — safety invariants

Must hold for **every** seed, dataset and revision. Defined in
`packages/draw-engine/src/invariants.ts`.

| ID | Invariant | Checked by | Phase 1 status |
|---|---|---|---|
| INV-01 | No hard-constraint violation: category partition, hard belt/movement policy, pool size ≤ `pool_max`, every range ≤ a `SET` maximum, manual seeds fixed | engine self-check on every run; property tests | Contract defined; engine stages Phase 3 |
| INV-02 | No entry placed more than once in a revision | `checkPlacementInvariants`; DB unique `pool_member_once_per_revision_uq` | **Enforced** (checker + DB, tested) |
| INV-03 | Every eligible in-scope entry placed; no ineligible or unknown entry placed | `checkPlacementInvariants`; eligibility gate | **Checker enforced**; gate Phase 2 |
| INV-04 | Every bracket structurally valid: `S = 2^⌈log₂n⌉` (min 2), `byes = S − n`, halves differ by ≤ 1 entry at every level, no bye-vs-bye first-round pair, exactly `n − 1` real matches, one final, every match reaches the final | property tests n = 1…512; DB checks `bracket_power_of_two_ck`, `bracket_byes_ck`, `bracket_rounds_ck` | **DB enforced**; generator Phase 3 |
| INV-05 | Deterministic replay: same input, rules, engine version, seed ⇒ identical output fingerprint | dual run per candidate (`draw_run_candidate_dual_run_ck`); replay tests; simulator | **Enforced** (engine contract, simulator, DB) |
| INV-06 | Valid revision state: legal lifecycle transitions, frozen content outside DRAFT, `lock_version` +1 per update, one official revision per category, no deletion | triggers + SQL↔TS parity tests + property tests | **Enforced** |
| INV-07 | Valid audit trail: append-only, hash chain linear and intact, every mutation has an event | triggers; chain recomputation checker (Phase 4) | **DB enforced**; recomputation Phase 4 |
| INV-08 | Manual seeds never moved by automatic placement | placement property tests | Phase 3 |

Additionally, the engine must return `UNSAFE` with machine-readable reasons — never a partial or
guessed draw — when a precondition fails (invalid rule set, blocked category, engine version
mismatch, candidate with simulation assumptions, unimplemented stage).

## 3. Gate B — quality benchmark

Baseline: `fixtures/baselines/committee-2026.json` (aggregates only; reproducible with
`tools/source-analysis/`). Physical metrics exclude pools containing dirty measurements.

| Metric | Committee 2026 (Kyorugi / Poomsae) | Direction |
|---|---|---|
| Pools with weight range ≤ 5 kg | 91.9% / 27.5% | higher |
| Pools with weight range ≤ 3 kg | 79.6% / 12.7% | higher |
| Pools with height range ≤ 5 cm | 45.3% / 68.3% | higher |
| Pools with height range ≤ 10 cm | 76.6% / 93.0% | higher |
| Height range median / p90 | 6 / 14 cm · 4 / 10 cm | lower |
| Weight range median / p90 | 2 / 5 kg · 8 / 21 kg | lower |
| Pools crossing a movement band | 271 / 0 | lower (Poomsae: must be 0 — it is a hard rule, so Gate A) |
| Single-contingent pools | 14 / 6 | lower |
| Same-contingent round-1 pairs | 4.9% / 5.8% | lower |
| Singleton (walkover) pools | 25 (both) | lower |

Semantics:

- The simulator reports each metric as `BETTER`, `EQUAL`, `WORSE` or `NOT_AVAILABLE`.
- `WORSE` on a metric that the configured rules prioritize (Tier 1) requires an explanation in the
  phase report: either a rule difference (e.g. the committee merged across classes, the engine
  may not) or an engine weakness with a follow-up.
- Weight metrics for Poomsae are informational while weight is disabled for Poomsae (Q5).
- Quality is measured on the golden seed **and** summarized as min / median / max across the
  robustness seeds; a quality result that holds only for one seed is not accepted.

## 4. Test matrix

| Tier | Files | Content | When |
|---|---|---|---|
| unit | `*.test.ts` | pure functions, known-answer vectors, rule-set readiness | every change |
| property | `*.property.test.ts` | fast-check invariants: PRNG, canonical JSON, state machines, eligibility, brackets n = 1…512 (Phase 3) | every change |
| golden | `*.golden.test.ts` | real 2026 dataset (SHA-256-verified, private); skipped with a notice if absent | every change on machines with the data; release gate |
| db | `*.db.test.ts` | migrations + every constraint/trigger on PGlite; also PostgreSQL 16 when `DATABASE_URL` is set | every change; CI runs both |
| simulation | `tools/draw-simulator` | golden seed + robustness seeds + baseline + replay | Phase 3 onward, every engine change |
| concurrency | Phase 4 | parallel conflicting commands on real PostgreSQL | Phase 4 onward |
| e2e | Phase 5 | import → review → draw → move/swap → lock → publish → amend | Phase 5 onward |
| load | Phase 3 / 7 | synthetic 5k and 10k, measured timings | release gate |

**Seeds** (`fixtures/datasets/manifest.json`)

- Golden seed `20260827` — reproducibility; its fingerprints are recorded per engine version.
- Robustness seeds — 20 fixed seeds (`1, 2, 3, 5, 8 … 10946`); every Gate-A check runs on all of
  them; quality is reported as a spread.
- Property tests additionally draw random 64-bit seeds (fast-check).

**Exhaustive comparison on small inputs**

- Bracket placement, n ≤ 8: exhaustive evaluation over the defined bracket-position search space
  (all distinct first-round arrangements up to bracket symmetry, byes placed by the configured
  policy) under the configured objective and constraints. No claim is made beyond that space.
- Pooling: for categories with ≤ 10 entries, tests enumerate every partition into pools of size
  1…`pool_max` and report the heuristic's cost gap to the exhaustive optimum under the same
  objective. The gap is reported per category; a gap > 0 is investigated, not silently accepted.

**Datasets**

| Dataset | Rows | Fingerprint | Use |
|---|---|---|---|
| REAL_2026 | 3,154 | `sha256:5b7539…5cce` | golden tests, baseline comparison |
| SYNTHETIC_5K | 5,000 | pinned in manifest | load (5k target), robustness |
| SYNTHETIC_10K | 10,000 | pinned in manifest | capacity (10k support) |

Synthetic datasets are regenerated deterministically; a changed fingerprint fails the drift test.

**Performance targets** (measured, never assumed; reported as p50 / p95 / max)

| Target | Threshold | Measured in |
|---|---|---|
| Draw engine, 5,000 entries | p95 < 30 s over the 20 robustness seeds | Phase 3 |
| Draw engine, 10,000 entries / 500 pools | completes; timing reported | Phase 3 |
| API mutation | p95 < 300 ms at normal load | Phase 4 |
| Drag feedback (client) | < 100 ms | Phase 5 |
| PDF export, 5,000 entries | < 3 min | Phase 6 |

## 5. Phase gates

### Phase 1 — foundations (this phase)

| Criterion | Result |
|---|---|
| Monorepo builds with strict TypeScript, tests typechecked | ✅ `pnpm typecheck` exit 0 |
| Lint clean, determinism rules active | ✅ `pnpm lint` exit 0; probe file triggers 4 errors |
| Migrations apply on PostgreSQL 16 and PGlite | ✅ 16.15 and 18.3 |
| Every DB invariant has a passing refusal test on both backends | ✅ 56/56 per backend |
| SQL state machines equal TypeScript state machines | ✅ parity tests |
| PRNG / fingerprint / UUID match an independent implementation | ✅ Python known-answer vectors |
| Provisional rule set: valid for SIMULATION/CANDIDATE, refused for LOCK with exact blockers | ✅ 4 × `MAX_TOLERANCE_UNSET`, 2 × `VALUE_TBD`, `RULE_SET_NOT_ACTIVE` |
| Simulator runs real + synthetic datasets, multi-seed, replay, baseline, deterministic report | ✅ |
| Engine refuses honestly for unimplemented stages | ✅ `ENGINE_STAGE_NOT_IMPLEMENTED` |

### Phase 2 — validation, normalization, categories

Expected values below were computed by an independent Python pass over the 2026 data under the
provisional rule set. The TypeScript implementation must reproduce them exactly; any difference
is investigated before either side is changed.

| Criterion | Expected |
|---|---|
| Rows imported, one `import_row` each, raw values byte-identical | 3,154 |
| Persons (distinct NIK after trailing-punctuation normalization) | 3,121 |
| Entries (pairs and teams merged) | 3,115 — 17 pair entries, 11 team entries |
| Entry groups | 28, source `HEURISTIC`, status `PROPOSED`, confidence `HIGH`; 0 ambiguous |
| Categories | 238 — Kyorugi prestasi 71, Kyorugi semi 105, Poomsae semi 36 (with movement), Poomsae prestasi 17, Freestyle 9 |
| Issue counts | HEIGHT_MISSING 9, WEIGHT_MISSING 9, HEIGHT_WEIGHT_LIKELY_SWAPPED 12, HEIGHT_OUT_OF_RANGE 1, WEIGHT_OUT_OF_RANGE 1, BMI_IMPLAUSIBLE 3, WEIGHT_CLASS_MISMATCH 252, AGE_DIVISION_PLAY_UP 64, AGE_DIVISION_CONFLICT 0, NIK_INVALID_FORMAT 56, NIK_NORMALIZED 6, NIK_GENDER_MISMATCH 22, NIK_BIRTHDATE_MISMATCH 59 (year) + 155 (day/month), DOB_POSSIBLE_PLACEHOLDER 14, ATHLETE_ATTRIBUTE_CONFLICT 1, ATHLETE_MULTIPLE_CONTINGENTS 11, CLASS_FORMAT_NORMALIZED 145, UNKNOWN_* 0 |
| Semi-prestasi entries blocked by default | 21 |
| No value silently corrected; every suggested correction stored with original | 100% |
| Synthetic 5k/10k import without error; issue rates within the injected rate | yes |

### Phase 3 — draw engine (gate before any complex UI)

The operator UI (Phase 5) does not start until all of these hold:

1. Property tests for brackets and byes, n = 1…512: all INV-04 properties.
2. Golden test on REAL_2026: Gate A passes for the golden seed and all 20 robustness seeds; every
   eligible semi-prestasi entry placed exactly once.
3. Deterministic replay: 100 consecutive runs of the golden seed produce one fingerprint;
   fingerprints recorded per engine version.
4. Baseline comparison produced for every metric of §3 on the golden seed and as a seed spread,
   with written explanations for every `WORSE`.
5. Exhaustive-comparison report for categories ≤ 10 entries and for bracket placement n ≤ 8.
6. Load: SYNTHETIC_5K p95 < 30 s across the 20 seeds; SYNTHETIC_10K completes.
7. Explainability: every pool has at least one structured reason; every walkover and every
   single-contingent pool has its specific reason code; every bye has a reason.
8. All five strategy candidates stored per category, exactly one selected, the selected one
   without Tier-0 violations.
9. Maximum tolerances still `UNSET` in the rule set: the engine produces candidate draws, and the
   lock readiness check still refuses.
