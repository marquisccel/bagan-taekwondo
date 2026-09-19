# Draw engine contract (engine 0.3.0; 0.2.0 → 0.3.0 = AUD-004 contingent-spread tie-break, see PHASE3_CALIBRATION §6)

Package `@bagantkd/draw-engine`. One entry point: **`runDraw(input: EngineInput): EngineOutput`**.
The function is pure: no clock, no I/O, no ambient randomness, no locale. Types are defined in
`src/contract.ts`, stable codes in `src/codes.ts`, and limits in `src/limits.ts`.

## Input — `EngineInput`

| Field           | Meaning                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `engineVersion` | Must equal the installed `ENGINE_VERSION`; otherwise the run is UNSAFE (`ENGINE_VERSION_MISMATCH`) |
| `purpose`       | `SIMULATION` or `CANDIDATE` (only a CANDIDATE can ever be lockable)                                |
| `seed`          | Unsigned 64-bit decimal string. It breaks ties and orders bracket placement; nothing else          |
| `ruleSet`       | A rule set as JSON; validated inside the engine (`RULE_SET_INVALID`)                               |
| `entries`       | Intake snapshot entries (`SnapshotEntry`). A **set**: array order is irrelevant                    |
| `scope`         | Category keys to draw; `[]` = every category. An unknown key → `SCOPE_CATEGORY_UNKNOWN`            |
| `assumptions`   | SIMULATION-only `SET` maxima (what-if). Refused for CANDIDATE; never written back                  |
| `limits?`       | Partial `EngineLimits`; omitted fields use the defaults                                            |

## Output — `EngineOutput`

| Field                                 | Meaning                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                              | `SAFE` · `UNSAFE` · `FAILED` (below)                                                                                                            |
| `unsafeReasons`                       | Structured reasons (`{code, params}`) for UNSAFE                                                                                                |
| `failure`                             | `{code, message}` for FAILED, else `null`                                                                                                       |
| `categories[]`                        | Per category: readiness, `blockedReasons`, eligible and withheld entry ids, the 5 strategy candidates, pools with brackets, explanation reasons |
| `quality.metrics`, `quality.findings` | Aggregates and findings (draw metrics only for SAFE)                                                                                            |
| `lock`                                | `{lockable, requiresAcknowledgement, blockers}` — the reasons why this run could not become LOCKED                                              |
| `limits`                              | The limits enforced                                                                                                                             |
| `fingerprints`                        | `input`, `rules`, `output` (SHA-256 of canonical JSON)                                                                                          |
| `stages`                              | Implementation status of the 14 stages (all `IMPLEMENTED`)                                                                                      |

**Status semantics**

- **SAFE**: every in-scope category is drawn and every self-check passed. Only a SAFE output
  contains pools, brackets and candidates.
- **UNSAFE**: an expected business or input outcome. `unsafeReasons` lists every cause; categories
  keep their readiness and reasons but carry **no pools and no candidates**. There are no partial or
  guessed draws.
- **FAILED**: an execution failure (a defect, or an input that cannot even be read). `failure.code`
  is stable (`ENGINE_INTERNAL_ERROR`, or a `DomainError` code). The output contains nothing else.
  A FAILED run is never retried into a different result: the same input fails the same way.

## Stage order

1. `normalizeEntries`
2. `validateEntries`
3. `gateEligibility`
4. `buildCategories`
5. `buildPools`
6. `optimizePools`
7. `repairPools`
8. `buildBracket`
9. `assignByes`
10. `placeSeeds`
11. `optimizeBracket`
12. `allocateMatchCodes` (stable `matchUid`s; public codes are a Phase 4 concern, ADR-0005)
13. `calculateQuality`
14. `generateExplanation`

Stages 5–14 run only for READY categories. Pool formation never reads bracket placement, and
placement never changes a pool.

## Guarantees of a SAFE output

- **INV-02/03:** every eligible in-scope entry is placed exactly once, only in its own category;
  no ineligible or unknown entry is placed. Self-checked before returning.
- **INV-04:** every bracket is valid:
  - power-of-two size and `byes = S − n`;
  - no bye meets a bye, and halves are balanced at every level;
  - `n − 1` real matches, one final, valid feeders.

  Self-checked for every pool.

- **INV-08:** a manual seed occupies the standard slot of its rank. Duplicate seed numbers, or a
  seed beyond the bracket, block the category (`MANUAL_SEED_INVALID`).
- **INV-01:** no pool breaks a hard constraint — `poolMax`, a `SET` maximum tolerance, or a hard
  belt band. A selected candidate never has Tier-0 violations.
- **Explainability:** every pool, bye, singleton, blocked category and candidate carries structured
  reasons, and every rejected local-search change is counted under a rejection code. Human text is
  never the source of truth.
- **Singletons** follow `poolPolicies.singleton`:
  - `WALKOVER_WITH_SUGGESTIONS`: a walkover plus adjacent-class `MERGE_SUGGESTION`s that require a
    Technical Delegate decision;
  - `BLOCK_CATEGORY`: the category waits for a person (`SINGLETON_POLICY_BLOCK`);
  - the engine never merges automatically.
- **Lock:** a run is lockable only if it is SAFE, is a CANDIDATE run, has no assumptions, and the
  rule set has no lock blocker. With maxima `UNSET` no run is lockable (`MAX_TOLERANCE_UNSET`).

## Determinism

The same entries (as a set), rule set, engine version, seed, scope, assumptions and limits always
give an identical `fingerprints.output`. This holds across retries, process restarts and worker
threads (`tools/draw-simulator/src/production.test.ts`). There is no dependence on array order,
`Math.random`, the clock, the locale, or database order: ids are sorted with an ordinal comparator,
costs are integers, and the PRNG is seeded by SHA-256.

## Resource limits (`RESOURCE_LIMIT_EXCEEDED`, never a hang)

| Limit                 | Default   | Scope                                                    | Largest seen (10K) |
| --------------------- | --------- | -------------------------------------------------------- | ------------------ |
| `maxEntries`          | 50,000    | run → UNSAFE before any work                             | 9,686              |
| `maxCategoryEntries`  | 2,000     | category → BLOCKED                                       | 338                |
| `maxBracketEntries`   | 512       | single-elimination category → BLOCKED                    | —                  |
| `maxPoolSize`         | 8         | pool policy `poolMax` → BLOCKED                          | 4                  |
| `maxPools`            | 20,000    | run → UNSAFE                                             | 2,071              |
| `maxWorkPerCandidate` | 5,000,000 | pool-cost evaluations of one strategy's search → BLOCKED | 432,584            |

Cost values saturate at 2^40 FP per dimension, so every cost stays an exact safe integer. A
wall-clock timeout, if one is needed, belongs to the caller (worker); the pure engine bounds its
work deterministically.

## Engine version semantics

`ENGINE_VERSION` changes whenever the output for the same input could change: algorithm, costs,
tie-breaking, or the output shape. The golden output fingerprint of every released version is
recorded in `fixtures/datasets/manifest.json` (`engineFingerprints`), and a golden test fails if it
drifts. Rule-set values are data, not engine version: they change `fingerprints.rules`.
