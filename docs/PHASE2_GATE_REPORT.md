# Phase 2 gate report — validation, normalization, categories

Status: **exit gate reached; Phase 3 not started.** All figures below are aggregates; row-level
detail stays in `data/private/` (git-ignored). Machine-generated reports for the 2026 dataset:
[`docs/reports/phase2-2026/`](reports/phase2-2026/) (`intake-report.md`,
`transformation-report.json`, `differential-report.json`, `engine-stages.json`), produced by
`pnpm intake-report`.

## 1. Exit criteria

| ID  | Criterion                                                                                                   | Result                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | TypeScript reproduces every ACCEPTANCE §5 Phase 2 value                                                     | ✅ all values exact (§3)                                                                                                                   |
| E2  | Python baseline (O2) = TypeScript (O3) on aggregates, every row and every entry                             | ✅ 0 differences: aggregates, 3,154 rows, 3,115 entries                                                                                    |
| E3  | Regression fixture (44 dirty-data rows): issues, severities, normalized values, suggestions                 | ✅ TypeScript = Python = hand-written expectations                                                                                         |
| E4  | Normalization unit + property tests; no normalizer loses the raw value                                      | ✅ 64 unit + 13 property tests; comparator self-test detects a single mutation                                                             |
| E5  | DB immutability, write-once, resolve-once, snapshot binding, re-import isolation — PGlite and PostgreSQL 16 | ✅ 15 tests × 2 backends (§5)                                                                                                              |
| E6  | 2026 intake persists into both backends in one transaction, counts = E1                                     | ✅ PGlite 18.3 and PostgreSQL 16.15 (§5)                                                                                                   |
| E7  | Engine stages 1–4 implemented; simulator `toEngineEntries` via intake; engine still refuses at `buildPools` | ✅ `ENGINE_STAGE_NOT_IMPLEMENTED {stage: buildPools}`; 0 intake disagreements, 0 category-key mismatches                                   |
| E8  | Data Transformation Report + Differential Report (aggregates committed)                                     | ✅ `docs/reports/phase2-2026/`; PII scan of every committed report: 0 names, 0 NIK, 0 birth dates, 0 registration ids                      |
| E9  | Determinism; SYNTHETIC_5K / 10K intake without error                                                        | ✅ same bytes + rules ⇒ same snapshot fingerprint (golden + property); 5K in 0.3 s, 10K in 0.4 s; data-defect issues only on injected rows |
| E10 | All previous tests pass; typecheck, lint, format clean locally and in CI                                    | ✅ locally. **CI not run**: it needs a push, which awaits approval                                                                         |

## 2. Test results (local, 2026-09-12)

| Tier      | Tests   | Notes                                                                                  |
| --------- | ------- | -------------------------------------------------------------------------------------- |
| unit      | 204     |                                                                                        |
| property  | 23      | normalizers (raw preserved, provenance present, idempotence), pipeline row-permutation |
| golden    | 10      | real 2026 data: intake O1/O2/O3, engine stages 1–4, simulator                          |
| db        | 88      | every db test on PGlite 18.3 **and** PostgreSQL 16.15 (44 each)                        |
| **total** | **325** | 24 files, 0 failed, 0 skipped                                                          |

`pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅.

Simulator (`pnpm simulate`, REAL_2026, golden seed 20260827 + 20 robustness seeds): replay
identical, 0 invariant violations, every seed `UNSAFE` with `CATEGORY_BLOCKED` +
`ENGINE_STAGE_NOT_IMPLEMENTED (buildPools)`. Lock blockers unchanged from Phase 1 (4 ×
`MAX_TOLERANCE_UNSET`, 2 × `VALUE_TBD`, `RULE_SET_NOT_ACTIVE`).

## 3. Transformation report (REAL_2026)

**3,154 rows → 3,121 persons → 3,115 entries (17 pairs, 11 teams) → 28 entry groups → 238
categories.** 0 unresolved rows.

| Categories by stream  | n   |     | Entry groups (source/status/confidence) | n   |
| --------------------- | --- | --- | --------------------------------------- | --- |
| Kyorugi prestasi      | 71  |     | HEURISTIC / PROPOSED / HIGH             | 28  |
| Kyorugi semi-prestasi | 105 |     | ambiguous or incomplete                 | 0   |
| Poomsae semi-prestasi | 36  |     |                                         |     |
| Poomsae prestasi      | 17  |     |                                         |     |
| Freestyle             | 9   |     |                                         |     |

Issues (per row for member-level checks, P2-A6): HEIGHT_MISSING 9, WEIGHT_MISSING 9,
HEIGHT_WEIGHT_LIKELY_SWAPPED 12, HEIGHT_OUT_OF_RANGE 1, WEIGHT_OUT_OF_RANGE 1, BMI_IMPLAUSIBLE 3,
WEIGHT_CLASS_MISMATCH 252, AGE_DIVISION_PLAY_UP 64, AGE_DIVISION_CONFLICT 0, NIK_INVALID_FORMAT
56, NIK_NORMALIZED 6, NIK_GENDER_MISMATCH 22, NIK_BIRTHDATE_MISMATCH 214 (59 year + 155
day/month), DOB_POSSIBLE_PLACEHOLDER 14, ATHLETE_ATTRIBUTE_CONFLICT 1,
ATHLETE_MULTIPLE_CONTINGENTS 11, CLASS_FORMAT_NORMALIZED 145, ENTRY_GROUP_UNCONFIRMED 28, every
UNKNOWN\_\* 0. By severity: **56 ERROR, 611 WARNING, 181 INFO**.

Normalized values: 145 weight classes (`=+NN`, `NN+` → `+NN`), 6 NIK trailing punctuation, 16
names (whitespace). Suggestions stored, none applied: 12 swaps (raw strings exchanged), and every
ambiguous class. 185 field transformations are persisted with raw, normalized, rule and
provenance.

**Blocked entries: 49** — semi-prestasi 21 (Kyorugi 17, Poomsae 4), Poomsae prestasi 25,
Freestyle 3. Reasons: ENTRY_GROUP_UNCONFIRMED 28, HEIGHT_WEIGHT_LIKELY_SWAPPED 11,
HEIGHT_MISSING 8, WEIGHT_MISSING 7, HEIGHT_OUT_OF_RANGE 1. The 28 pair/team entries unblock when
a person confirms their heuristic group.

**Engine stages 1–4:** 3,066 eligible, 49 withheld, 0 malformed, 0 intake disagreements, 0
category-key mismatches. 238 categories: **207 READY, 31 BLOCKED** (Kyorugi semi 15, Poomsae semi 4,
Poomsae prestasi pair 4 / team 5, Freestyle pair 3) under the readiness policy
`BLOCK_CATEGORY` (ENGINEERING_DEFAULT, §6); 12 of the 31 have no eligible entry at all. All 24
singleton categories are READY; their handling
(walkover / merge suggestion / Technical Delegate decision) is `poolPolicies.singleton`, applied
at pooling.

Synthetic datasets (after the generator fixes in §6): 5K → 5,000 persons, 4,876 entries, 203
categories, 58 rows unresolved (ambiguous groups), 73 blocked; 10K → 10,000 persons, 9,686
entries, 217 categories, 205 unresolved, 116 blocked. Ambiguity comes from several pairs/teams per
contingent and division without a group id; it is blocked, never guessed.

## 4. Differential result

| Comparison                           | Scope                                                                     | Result          |
| ------------------------------------ | ------------------------------------------------------------------------- | --------------- |
| O3 (TypeScript) vs O1 (acceptance)   | every ACCEPTANCE §5 value                                                 | equal           |
| O3 vs O2 (Python), aggregates        | pipeline, groups, categories, blocked, issues, severities, field outcomes | 0 differences   |
| O3 vs O2, detail (private)           | issue set of 3,154 rows; members, category, eligibility of 3,115 entries  | 0 differences   |
| O3 and O2 vs hand-written fixture    | 44 rows, 37 entries, suggestions, normalized values                       | equal           |
| Engine stages 1–4 vs intake snapshot | eligibility and category key of every entry                               | 0 disagreements |

No expected value was changed. The one plan correction (swap rule, §12 of the plan) was found by
the O1-vs-O2 differential and brings both implementations to the O1 values.

## 5. Persistence result

`persistIntake` writes batch → rows (raw + normalized trace) → field transformations → issues
(rule + provenance on every issue) → athletes (NIK AES-256-GCM + HMAC-SHA-256 blind index) →
contingents, entries, members, entry groups → COMMITTED → intake snapshot, in the caller's single
transaction.

| REAL_2026, one transaction | PGlite 18.3                 | PostgreSQL 16.15            |
| -------------------------- | --------------------------- | --------------------------- |
| import rows                | 3,154                       | 3,154                       |
| field transformations      | 185                         | 185                         |
| validation issues          | 848                         | 848                         |
| athletes (NIK encrypted)   | 3,121                       | 3,121                       |
| entries / members / groups | 3,115 / 3,154 / 28          | 3,115 / 3,154 / 28          |
| blocked entries (semi)     | 49 (21)                     | 49 (21)                     |
| snapshot entries           | 3,115, fingerprint verified | 3,115, fingerprint verified |
| duration                   | ≈ 2.3 s                     | ≈ 2.1 s                     |

Refusal tests on both backends: committed batch, its rows and transformations cannot be changed,
added or deleted; `normalized` written once; commit refused while rows are missing; SQL batch
lifecycle equals `IMPORT_BATCH_TRANSITIONS`; a resolution is recorded once, only by a non-viewer
member of the tournament, with a ≥ 15-character reason, and never on insert; snapshots are
append-only, require a COMMITTED batch and must match their content; `draw_run` requires a snapshot
of its own tournament and cannot be re-bound; `loadSnapshot` rejects a snapshot altered behind the
triggers; a failure rolls the whole intake back. **Re-import** (instruction 5): new batch and
snapshot; the old snapshot, the draw run bound to it and the live entries are unchanged;
`diffIntake` reports 1 removed and 1 changed entry.

## 6. Decisions and corrections made in Phase 2

| Item                                  | Decision                                                                                                                                                                                                                                                | Provenance          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Swap rule                             | Either value implausible **and** the swapped pair fully plausible (plan §12)                                                                                                                                                                            | ENGINEERING_DEFAULT |
| Category readiness                    | New rule-set field `categoryReadiness.withheldEntries`: `BLOCK_CATEGORY` (a category with withheld entries is not drawn partially) or `DRAW_ELIGIBLE_ONLY`. Set to `BLOCK_CATEGORY` pending committee. Not a lock blocker. Singletons are not affected. | ENGINEERING_DEFAULT |
| Movement of multi-member entries      | All members must resolve to the same movement (was: first member). No 2026 template is affected; both oracles updated                                                                                                                                   | ENGINEERING_DEFAULT |
| Unverifiable key of a withheld entry  | `CATEGORY_KEY_UNVERIFIED` (INFO); the entry still blocks its registered category                                                                                                                                                                        | ENGINEERING_DEFAULT |
| Registered value in conflict          | Stored as null on `athlete` (the conflict issue and raw rows keep every value); `athlete.full_name` / `gender` became nullable                                                                                                                          | ENGINEERING_DEFAULT |
| Re-import                             | Stores batch, rows, transformations, issues, snapshot; never touches live entries; person/entry issues attach to their first source row                                                                                                                 | Plan §8             |
| Synthetic generator defects (Phase 1) | Weight class chosen from the unrounded weight; weights outside an observed-subset table; colliding random NIKs. Fixed; SYNTHETIC_5K / 10K fingerprints re-pinned in `fixtures/datasets/manifest.json`                                                   | —                   |

## 7. Unresolved decisions (for review before Phase 3)

| ID   | Decision needed                                                                                                                         | Current value                          | Owner          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------- |
| U-01 | Category readiness with withheld entries                                                                                                | `BLOCK_CATEGORY` (ENGINEERING_DEFAULT) | Committee      |
| U-02 | Maximum height/weight tolerances (lock blockers)                                                                                        | `UNSET` × 4                            | Committee      |
| U-03 | Two category templates with `TBD` provenance (lock blockers)                                                                            | `TBD` × 2                              | Committee      |
| U-04 | Official weight-class tables (only observed subsets exist; no class is inferred)                                                        | OBSERVED_SUBSET                        | Committee      |
| U-05 | Confirmation of the 28 heuristic pair/team groups (they block 28 entries until confirmed)                                               | PROPOSED                               | Committee / TD |
| U-06 | P2-A1 person identity = normalized NIK, also for invalid-format NIK                                                                     | ENGINEERING_DEFAULT                    | Committee      |
| U-07 | P2-A2 `NIK_BIRTHDATE_MISMATCH` stays WARNING                                                                                            | ENGINEERING_DEFAULT                    | Committee      |
| U-08 | P2-A3 grouping key, P2-A4 Freestyle in PRESTASI                                                                                         | EVIDENCE_2026                          | Committee      |
| U-09 | P2-A5 declared division/class authoritative (252 class mismatches and 64 play-ups stay warnings)                                        | STAKEHOLDER                            | Committee      |
| U-10 | Applying a re-import to live entries (reviewed command)                                                                                 | not implemented                        | Phase 4        |
| U-11 | Materializing `category` rows needs relational rule-set persistence; `entry.category_id` is null in Phase 2 (keys live in the snapshot) | deferred                               | Phase 3/4      |
| U-12 | CI run of this phase (requires a push), and the move to `D:\KULIAH\project-non-related\`                                                | pending                                | User           |

## 8. Files

- **New packages/modules**
  - `packages/intake/`: the pure pipeline — normalize, rows, persons, entries, categories, snapshot, diff, report, and csv (moved in from the simulator).
  - `packages/draw-engine/src/stages.ts`
  - `packages/db/src/intake-repository.ts`, `packages/db/src/nik-crypto.ts`, `packages/db/src/schema/intake.ts`, `packages/db/src/testing/seed.ts`
  - `packages/domain/src/import-batch.ts`
  - `tools/draw-simulator/src/intake-report.ts`
  - `tools/phase2-baseline/baseline.py`
- **Migrations:** `0002_intake_schema.sql` (tables and columns) and `0003_intake_triggers.sql` (guards).
- **Tests**
  - intake: `normalize`, `normalize.property`, `dirty-cases`, `diff`, `real-2026.golden`
  - engine: `stages`, `real-2026.golden`
  - db: `intake.db`, `intake-real-2026.db`
  - simulator: `intake-report`, `synthetic-intake`
- **Fixtures and reports**
  - `fixtures/intake/`: dirty-case generator, CSV, expectations and Python outputs
  - `fixtures/baselines/phase2-2026-counts.json`
  - `docs/reports/phase2-2026/`
- **Changed**
  - rule-set schema, generator and fixture (`categoryReadiness`, vocabulary provenance)
  - `packages/domain/src/issues.ts`
  - engine `contract.ts` and `run.ts`
  - simulator `simulate.ts`, `synthetic.ts` and `cli.ts`
  - db schema (`participants`, `draw`, `enums`), `test-db.ts` and the seed of `schema.db.test.ts`
  - `fixtures/datasets/manifest.json`
  - workspace wiring
- **Documents:** `docs/PHASE2_PLAN.md` and this report.
