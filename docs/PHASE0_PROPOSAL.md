# Phase 0 Proposal — Architecture, Domain, Algorithm, Plan

|            |                                                                             |
| ---------- | --------------------------------------------------------------------------- |
| Status     | For approval — no production code written yet                               |
| Date       | 2026-09-11                                                                  |
| Depends on | `docs/SOURCE_ANALYSIS.md` (fact IDs `F-xx`, rules `R-xx`, questions `Q-xx`) |

> **Review outcome (2026-09-11).** Approved with changes, now recorded as ADRs in `docs/adr/`:
> correctness = safety invariants, the 2026 draw = quality benchmark (ADR-0012); maximum tolerances
> stay UNSET until the committee decides (ADR-0007); explicit multi-tier objective with all strategy
> candidates retained (ADR-0008); EntryGroupSource (ADR-0010); RegistrationStatus vs
> EligibilityStatus and Technical Delegate overrides (ADR-0011); draw simulator as a first-class
> tool. Where this proposal differs from an ADR, the ADR wins.

Items that deviate from the engineering brief are marked **[DEVIATION]** with the reason. Each becomes an ADR in Phase 1 if approved.

---

## 1. Architecture

### 1.1 Shape

Modular monolith in one TypeScript monorepo (pnpm workspaces + Turborepo).

```
apps/
  web        Next.js (App Router), React, dnd-kit, SVG bracket rendering
  api        NestJS HTTP API — thin controllers, application services, domain commands
  worker     NestJS standalone process — draw, import, export jobs (same codebase as api)
packages/
  domain        entities, value objects, command/event types, invariants (no I/O)
  draw-engine   pure deterministic engine (no I/O, no clock, no Math.random)
  validation    normalization + validation rules + issue codes (pure)
  shared        zod schemas, error codes, IDs, canonical JSON, hashing
  ui            design tokens, bracket SVG components, shared React components
  db            schema (Drizzle), migrations, repositories
tools/
  source-analysis   Phase 0 evidence script
```

Dependency rule: `draw-engine` and `validation` depend only on `domain` and `shared`. They are imported by `api`, `worker` and `web` (client-side predictive validation uses the same code as the server).

### 1.2 Runtime

```
Browser ──HTTPS──► api (NestJS) ──► PostgreSQL 16
                     │  enqueue (same transaction as DrawRun row)
                     ▼
                  job queue ──► worker: draw · import · pdf/xlsx export
```

- **Queue: pg-boss on PostgreSQL instead of Redis + BullMQ for the MVP.** **[DEVIATION]** The job row and the `DrawRun` row commit in one transaction (no lost or orphaned jobs), and a venue deployment runs one fewer stateful service. Load is a handful of jobs per hour; a 5,000-entry draw is an estimated 2–10 s of CPU. The queue sits behind a `JobQueue` port, so BullMQ can replace it without touching domain code. If you prefer to follow the brief exactly, BullMQ is a one-ADR change.
- **Deployment:** a single Docker Compose file runs the whole system on **one laptop at the venue** or on a server. This addresses your earlier question about running locally: the web UI is required for drag and drop, but nothing requires the cloud.
- **ORM: Drizzle** (typed SQL, explicit transactions, SQL migrations kept in the repo). Prisma is the alternative; Drizzle stays closer to SQL for row-locking and optimistic-concurrency statements.
- **PDF:** print-optimized HTML/SVG rendered by headless Chromium (Playwright) in the worker, so the screen bracket and the printed bracket share one component. Chromium lives only in the worker image.

### 1.3 Cross-cutting decisions

| Concern                  | Decision                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Units                    | Height stored as integer **mm**, weight as integer **grams**. No floating point inside the engine, which removes one class of cross-platform nondeterminism.                                 |
| Randomness               | `xoshiro128**` PRNG seeded from `DrawRun.seed`; each category gets a derived sub-seed `hash(seed, categoryKey)`, so re-drawing one category does not shift others.                           |
| Ordering                 | All sorts use explicit total-order comparators ending in a stable id; never `localeCompare`, never insertion order.                                                                          |
| Canonical output         | Canonical JSON (sorted keys, normalized numbers) → SHA-256 fingerprint, stored for input snapshot, rule snapshot, draw output and quality report.                                            |
| Versioning               | `engine_version` (semver) and `algorithm_id` per stage stored on every `DrawRun`.                                                                                                            |
| Validation at boundaries | zod schemas for HTTP, import rows, rule sets and job payloads.                                                                                                                               |
| Errors                   | Stable machine codes (`HEIGHT_WEIGHT_LIKELY_SWAPPED`, `REVISION_CONFLICT`, …) with parameters; human text rendered from templates (Indonesian default, English).                             |
| Auth                     | Server-side sessions (httpOnly, Secure, SameSite=Strict cookies), Argon2id password hashing, RBAC evaluated per tournament membership on every command.                                      |
| Sensitive data           | NIK encrypted at application level (AES-256-GCM, key from environment/KMS) plus an HMAC blind index for identity matching. Birth date restricted by role. Neither appears in public exports. |
| Observability            | pino structured logs with request/command/draw-run correlation ids; Prometheus metrics (names as in the brief); `/health/live`, `/health/ready`.                                             |

---

## 2. Domain model

### 2.1 Changes the evidence forces on the brief's model

| Change                                                                                                                                  | Evidence                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Contingent belongs to `Entry`, not `Athlete`.**                                                                                       | F-06: 11 people compete for different contingents in different entries |
| **Measurements and belt belong to `TournamentAthlete`** (the person within one tournament), with conflict detection across import rows. | F-07                                                                   |
| **Category gender is `MALE                                                                                                              | FEMALE                                                                 | MIXED`**, derived from the format rule (pair = mixed). | F-04, C-02 |
| **Movement band is an optional category dimension**, derived from belt via a configurable map.                                          | F-33                                                                   |
| **`ContingentGroup`** (optional) lets separation treat `Kota Surabaya 1…11` as one family.                                              | F-12, Q-06                                                             |
| **Declared class is authoritative**; registered weight never re-categorizes an entry.                                                   | F-19, A-12                                                             |

### 2.2 Tables (core columns only)

**Configuration**

| Table               | Key columns                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament`        | id, name, event_start, event_end, timezone, status                                                                                                                                      |
| `rule_set`          | id, tournament_id, version, status (DRAFT/ACTIVE/RETIRED), snapshot_jsonb, fingerprint                                                                                                  |
| `age_division`      | id, rule_set_id, code, stream, policy (BIRTH_YEAR/AGE_ON_DATE/CUSTOM), min_birth_year, max_birth_year, play_up_policy                                                                   |
| `weight_class`      | id, rule_set_id, stream, age_division_id, gender, code, lower_g, upper_g (null = open)                                                                                                  |
| `belt`              | id, rule_set_id, code, rank, label                                                                                                                                                      |
| `belt_band`         | id, rule_set_id, code; `belt_band_member(belt_id, band_id)`                                                                                                                             |
| `movement_map`      | id, rule_set_id, belt_band_id, movement_code                                                                                                                                            |
| `category_template` | id, rule_set_id, stream, discipline, format, partition_dimensions (ordered enum list), gender_mode                                                                                      |
| `pool_policy`       | id, rule_set_id, category_template_id, pool_min, pool_target, pool_max, tolerances (ideal/max per dimension, per division), weights, singleton_policy, belt_policy (HARD/SOFT/DISABLED) |
| `arena`, `session`  | arena code, day, session windows                                                                                                                                                        |
| `contingent`        | id, tournament_id, name, contingent_group_id                                                                                                                                            |

**Participants and import**

| Table                | Key columns                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import_batch`       | id, tournament_id, source_filename, source_sha256, mapping_jsonb, status, created_by                                                                                                                                                                     |
| `import_row`         | id, batch_id, row_number, raw_jsonb (immutable), normalized_jsonb, entry_id                                                                                                                                                                              |
| `athlete`            | id, nik_ciphertext, nik_blind_index, full_name, gender, birth_date                                                                                                                                                                                       |
| `tournament_athlete` | id, tournament_id, athlete_id, registered_height_mm, registered_weight_g, registered_belt_id                                                                                                                                                             |
| `weigh_in_record`    | id, tournament_athlete_id, verified_height_mm, verified_weight_g, verified_at, verified_by                                                                                                                                                               |
| `entry`              | id, tournament_id, contingent_id, declared_stream, declared_discipline, declared_format, declared_age_division, declared_weight_class, category_id, eligibility (REGISTERED/VALIDATION_ERROR/VERIFIED/DRAW_ELIGIBLE/DRAWN/WITHDRAWN/DQ/NO_SHOW), seed_no |
| `entry_member`       | entry_id, tournament_athlete_id, position                                                                                                                                                                                                                |
| `validation_issue`   | id, subject_type, subject_id, code, severity, field, raw_value, suggested_value, params_jsonb, status (OPEN/ACCEPTED/OVERRIDDEN/RESOLVED), resolved_by, resolution_reason                                                                                |

**Draw**

| Table                 | Key columns                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `category`            | id, tournament_id, rule_set_id, key (canonical), stream, discipline, format, age_division_id, gender_mode, weight_class_id, movement_code                                                                                |
| `draw_run`            | id, tournament_id, rule_set_id, scope_jsonb, seed, engine_version, input_fingerprint, rules_fingerprint, output_fingerprint, status (QUEUED/RUNNING/SAFE/UNSAFE/FAILED), unsafe_reasons_jsonb, params_jsonb, duration_ms |
| `draw_revision`       | id, draw_run_id, revision_no, parent_revision_id, lifecycle (DRAFT/REVIEW/APPROVED/LOCKED/PUBLISHED/AMENDED/SUPERSEDED), content_fingerprint, lock_version                                                               |
| `pool`                | id, revision_id, pool_uid (stable across revisions), category_id, ordinal, metrics_jsonb, explanation_jsonb                                                                                                              |
| `pool_member`         | pool_id, entry_id                                                                                                                                                                                                        |
| `bracket`             | id, pool_id, size, rounds                                                                                                                                                                                                |
| `bracket_slot`        | bracket_id, position, entry_id (null = BYE), seed_no, bye_reason_code                                                                                                                                                    |
| `match`               | id (UUID, internal), revision_id, match_uid (stable), bracket_id, round, position, source_a, source_b, arena_id, order_no, public_code                                                                                   |
| `match_code_registry` | tournament_id, arena_id, public_code, match_uid, first_revision_id, retired_revision_id — codes are never reused                                                                                                         |
| `quality_report`      | revision_id, report_jsonb, fingerprint, errors, warnings                                                                                                                                                                 |
| `draw_command`        | id, revision_id (base), resulting_revision_id, type, payload_jsonb, expected_revision_no, idempotency_key, actor_id, reason, complaint_id, outcome (APPLIED/REJECTED), rejection_code                                    |
| `audit_event`         | id, tournament_id, occurred_at, actor_id, action, subject_type, subject_id, before_jsonb, after_jsonb, reason, complaint_id, command_id — append-only (no UPDATE/DELETE grants)                                          |
| `complaint`           | id, tournament_id, filed_by, subject_ref, reason, status (OPEN/UNDER_REVIEW/ACCEPTED/REJECTED/RESOLVED), decision, decided_by, resulting_command_id, resulting_revision_id                                               |

### 2.3 Revision storage

Copy-on-write snapshots: each `draw_revision` owns its own `pool / pool_member / bracket / bracket_slot / match` rows. A 5,000-entry revision is roughly 5k member rows and 3k match rows, so hundreds of revisions stay small. Commands and audit events record the _why_; snapshots make every revision directly queryable, printable and diffable without replaying history.

`pool_uid` and `match_uid` persist across revisions for the same logical pool or match, which is what makes public match codes stable (§3.8).

### 2.4 Lifecycle and concurrency

```
DRAFT ─► REVIEW ─► APPROVED ─► LOCKED ─► PUBLISHED
  ▲         │                                 │
  └─────────┘ (reject)            amend ──────┴─► new revision (DRAFT, parent = published)
                                                  on publish: old → SUPERSEDED
```

- Only `DRAFT` revisions accept commands. A command on a `LOCKED` or `PUBLISHED` revision first requires an explicit _amend_, which creates a child revision.
- Every command carries `expected_revision_no`; the transaction does `UPDATE … SET lock_version = lock_version + 1 WHERE id = ? AND lock_version = ?`. Zero rows → `REVISION_CONFLICT`.
- Every command carries an `idempotency_key`; a replay returns the original outcome.
- `LOCK` is refused while the quality report contains any `ERROR`, any in-scope category is `BLOCKED`, or any `WARNING` is unacknowledged.

---

## 3. Algorithm design

### 3.1 Pipeline

```
normalizeEntries → validateEntries → gateEligibility → buildCategories
  → (per category) buildPools → optimizePools → repairPools
  → buildBracket → assignByes → placeSeeds → optimizeBracket
  → allocateMatchCodes → calculateQuality → generateExplanation
```

Each step is a pure function `(input, rules, rng) → output + issues`. The engine never reads a clock, a database or the network. The worker records wall time around it.

### 3.2 Safety gate — "draw cannot be safely generated"

Before any pooling, each in-scope category is classified `READY` or `BLOCKED`. `BLOCKED` reasons include:

- an eligible-scope entry has an unresolved `ERROR` issue;
- the rule set lacks a value the category needs (weight-class table, max tolerance, movement map);
- an entry group (pair/team) is ambiguous or incomplete;
- the category's rule-set fingerprint changed since the scope was chosen.

A draw run whose scope contains a `BLOCKED` category ends in status **`UNSAFE`** with a structured reason list. Nothing is produced for those categories. The operator can narrow the scope to `READY` categories, so one bad category does not hold the whole tournament hostage. A revision can never be locked while it contains an unsafe category.

As a determinism self-check, the worker executes the engine twice in separate isolates for the final run and compares output fingerprints. Cost: seconds. Benefit: catches any latent nondeterminism before it reaches a committee.

### 3.3 Category engine

A `category_template` declares the ordered partition dimensions per stream × discipline × format. Defaults from the evidence:

| Template                             | Partition dimensions                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Kyorugi (prestasi, semi)             | stream, age division, gender, weight class                                    |
| Poomsae individual / team (prestasi) | stream, age division, gender, format                                          |
| Poomsae pair (prestasi)              | stream, age division, **MIXED**, format                                       |
| Poomsae semi prestasi                | stream, age division, gender or MIXED, format, **movement band**              |
| Freestyle                            | stream, age division, gender or MIXED, format — performance order, no bracket |

Derived dimensions (movement band, computed age division) are pure functions of the entry and the rule set. `source_age_division` is kept, and a disagreement with `computed_age_division` raises `AGE_DIVISION_PLAY_UP` or `AGE_DIVISION_CONFLICT`.

### 3.4 Semi prestasi pool engine

**Problem.** Partition each category's eligible entries into pools of size 1…`pool_max` (default 4) so that pools are physically homogeneous, preferably of size 4, and contingents are mixed, subject to hard limits. This is a capacitated, constrained clustering problem. It is NP-hard in general, so the engine is heuristic and **no global optimality is claimed**. Quality is proven empirically against the committee baseline (SOURCE_ANALYSIS §8.1) and, in tests, against exhaustive search on small categories.

**Priority model.** The brief orders fairness as hard eligibility > physical > bracket > contingent. A strict lexicographic order would make contingent diversity act only as a tie-breaker. Instead, the model uses an explicit **no-regression rule**:

1. **Tier 0 — hard:** any pool with a range above `tol_max` on any active dimension, a hard belt/movement conflict, or a size above `pool_max` is infeasible.
2. **Tier 1 — physical + size:** `C_phys(P) + C_size(P)`.
3. **Tier 2 — bracket fairness and contingent:** `C_bracket(P) + C_cont(P)`.
4. A move that improves Tier 2 is accepted only if (a) no affected pool goes from within ideal tolerance to outside it, and (b) the Tier 1 increase is ≤ `tier1_slack` (configurable, default small). This lets the engine mix contingents _within_ physical fairness but never _at the expense of_ it. It also makes the priority order a configuration value, not a code change.

**Cost terms** (all weights and tables live in `pool_policy`; nothing is hard-coded):

```
For each active dimension d ∈ {weight, height, belt}:
  x_d   = range_d(P) / tol_ideal_d                     (range = max − min, integer units)
  dev_d = a_d · x_d + b_d · max(0, x_d − 1)²           gentle inside tolerance, steep beyond it
C_phys(P) = Σ_d dev_d
C_size(P) = size_penalty[|P|]                           default {4: 0, 3: s3, 2: s2, 1: s1}
C_cont(P) = c · (largest_contingent_share(P) − 1/|P|)   0 when perfectly mixed
C_bracket(P) = min over legal pairings of same-contingent round-1 meetings (exact, |P| ≤ 4)
```

Default dimension activation from the evidence: Kyorugi semi = weight + height + belt(soft); Poomsae semi = height (+ belt hard through movement). Default weights and size penalties are **calibrated against the configured rules** and reported against the 2026 benchmark (ADR-0012) — the engine is not tuned to reproduce the committee's pools. The calibration script and its output are committed. The calibrated values are proposed defaults for the committee to confirm; they are not rules.

**Construction (Phase 3 of the engine).** Five deterministic strategies each produce a complete partition:

| Strategy           | 1-D ordering used                                                    |
| ------------------ | -------------------------------------------------------------------- |
| `WEIGHT_FIRST`     | weight, height, belt, id                                             |
| `HEIGHT_FIRST`     | height, weight, belt, id                                             |
| `BELT_FIRST`       | belt rank, weight, height, id                                        |
| `BALANCED`         | Σ_d (value_d / tol_ideal_d), id                                      |
| `CONTINGENT_AWARE` | `BALANCED` ordering, with `C_cont` included in the segmentation cost |

For a fixed ordering, the best _contiguous_ partition into segments of length ≤ `pool_max` is found exactly by dynamic programming:

```
D[0] = 0
D[j] = min_{k = 1..pool_max, feasible} ( D[j−k] + cost(A[j−k .. j−1]) )
```

This runs in O(m · pool_max) per strategy — trivial even for the 135-entry category. It is optimal only relative to that ordering, which is why local search follows.

**Local optimization (Phase 4).** From each strategy's partition: first-improvement search over _move_ (one entry to another pool, sizes permitting) and _swap_ (two entries between pools) neighbourhoods within the category, with candidate order drawn from the category's seeded PRNG, the no-regression rule above, and a fixed budget (`k · m` evaluations). Same seed → same result.

**Repair (Phase 5).** Singletons first try every feasible move/swap that absorbs them; if none exists, they remain walk-over pools. Adjacent-class merges are **never automatic**. The engine attaches ranked merge _suggestions_ (with the resulting physical ranges) for the operator, as the committee did by hand in 2026 (F-35).

**Selection.** The lowest-cost result across strategies wins; ties break by the fixed strategy order. All five results' metrics are stored, so the operator can see alternatives.

**Quality and explanation (Phase 6).** Each pool stores structured reasons, rendered to text, for example:

- `POOL_CLOSED_BY_WEIGHT_RANGE {next_entry, would_be_range_kg: 6.5, tol_ideal_kg: 5}` → "Pool P-17 has 3 athletes because adding the next athlete would widen the weight range to 6.5 kg, above the 5 kg ideal."
- `SINGLE_CONTINGENT_NO_FEASIBLE_SWAP {contingent, candidates_checked}` → "Pool P-08 contains only Kota Surabaya 2 because no swap within the maximum tolerance was found (14 candidates checked)."
- `SINGLETON_NO_COMPATIBLE_PARTNER {nearest_entry, height_gap_cm}` → "… the closest athlete differs by 17 cm, above the configured maximum."

### 3.5 Bracket engine (independent of pooling)

- `S = 2^⌈log₂ n⌉` (minimum 2), `byes = S − n`.
- Slot layout uses the standard seed-position order (1, S, S/2+1, S/2, …), so byes fall to the highest seed positions and are spread evenly between halves by construction. This yields your stated structures: 3 → one semi-final plus a bye into the final; 5 → 3 + 2 halves; 7 → 4 + 3.
- `n = 1` → walk-over bracket; it still consumes a public match number, as in the 2026 output (F-31).
- Winner-progression graph generated explicitly (`match.source_a/b`), never implied by position arithmetic in the UI.
- Property tests for every n ∈ 1…512: slot count is a power of two, bye count = S − n, every entry appears exactly once, halves differ by at most one entry at every level, exactly n − 1 real matches, every match reaches the final, and manual seed invariants hold.

### 3.6 BYE policy (separate, explainable)

Policies: `SEED_PRIORITY` (byes to highest seeds; standard for prestasi), `CONTINGENT_AWARE` (bye goes where it removes a same-contingent early meeting), `RANDOM_SEEDED`. In a semi prestasi pool of 3, the policy decides who waits in the final. Every bye records a reason code, e.g. `BYE_SEED_PRIORITY {seed: 1}` or `BYE_AVOIDS_SAME_CONTINGENT_R1 {contingent}`.

### 3.7 Seeding and placement

- Manual seeds are placed first on standard positions and are immutable to every later step (enforced by the optimizer and asserted by tests).
- Penalty: `Σ same-contingent pairs 2^(R − r_meet)`, where `r_meet` is the round in which they would first meet.
- **n ≤ 8 (every semi prestasi pool, most prestasi brackets):** exhaustive evaluation over the defined bracket-position search space (all distinct first-round arrangements up to bracket symmetry — 315 for n = 8, 3 for n = 4 — with byes placed by the configured policy) under the configured objective and constraints; ties break by seeded PRNG rank. No optimality is claimed outside that search space (ADR-0012).
- **n > 8:** largest-contingent-first distribution across quarters and eighths, then seeded swap search with seeds pinned.

### 3.8 Public match codes

- Internal `match.id` is a UUID per revision row; `match_uid` identifies the logical match across revisions (pool_uid + round + position).
- Codes (`A017`) are allocated per arena in schedule order when a revision is first approved.
- On a new revision, a match whose `match_uid` survives keeps its code. New matches take the next unused code in that arena. Removed codes are retired in `match_code_registry` and **never reused** in the tournament. The amendment notice lists changed, new and retired codes.
- Moving one athlete between two existing pools changes no codes at all: slot contents change, match identities do not.

### 3.9 Quality report

Every run and revision: entries, categories, pools, pool-size distribution, ideal- and max-tolerance compliance per dimension, belt and contingent distributions, single-contingent pools, same-contingent round-1 pairs, bye distribution, walk-over count, hard violations, warnings. Each finding is `ERROR`, `WARNING` or `INFO`, with the entity it refers to. Where a 2026 baseline exists, the report shows engine vs committee side by side.

### 3.10 Commands (manual correction)

`MoveEntry`, `SwapEntries`, `MovePool`, `AddEntry`, `RemoveEntry` (withdraw/DQ/no-show), `RegeneratePool`, `RegenerateCategory`, `AmendBracket`, `SetSeed`, `AcknowledgeWarning`. Each command:

1. authorizes the actor for this tournament and command type;
2. checks `expected_revision_no`;
3. evaluates hard constraints — rejected with a code if violated (RED);
4. evaluates soft constraints — requires `reason` if any worsen (YELLOW);
5. writes the new revision state, recomputes affected metrics and codes, and appends the audit event in the same transaction.

The browser calls the same `validation`/`draw-engine` functions for instant GREEN/YELLOW/RED feedback, but the server re-evaluates everything.

---

## 4. Recommended MVP scope

**In scope**

| Area           | MVP content                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import         | CSV/XLSX, column mapping presets, `entry_group` column with heuristic fallback proposal, dry-run, immutable raw rows                                                                               |
| Data quality   | Full issue register (SOURCE_ANALYSIS §6), review screen, accept/override/correct with audit                                                                                                        |
| Rules          | Rule-set editor for divisions, classes, belts, bands, movement map, pool policy, tolerances; versioned snapshots; 2026 rule set as a template                                                      |
| Engine         | Categories, semi prestasi pooling, prestasi brackets, byes, manual seeds, contingent separation, quality report, explanations, safety gate                                                         |
| Draw lifecycle | Draw runs, revisions, all commands in §3.10, optimistic concurrency, audit, lock, publish, amend                                                                                                   |
| Workspace      | Category list with quality badges, pool/bracket view, drag and drop within and across pools of a category, GREEN/YELLOW/RED, reason capture, undo via inverse command                              |
| Export         | PDF brackets (per arena/day), PDF match list, PDF scoresheet, XLSX participants/pools, freestyle order list; revision, timestamp and status on every page; no NIK; formula-injection-safe XLSX/CSV |
| Security       | Login, 4 roles (Admin, Drawing Officer, Technical Delegate, Viewer), tournament scoping, encrypted NIK                                                                                             |
| Ops            | Docker Compose, health endpoints, structured logs, metrics                                                                                                                                         |

**Deferred**

Complaint _UI_ (the domain object and API ship in MVP), weigh-in UI (the data model ships; the policy defaults to registered data), automatic arena scheduling, public read-only pages, cached offline viewer (PDF is the MVP fallback), contingent-manager role, SSO.

---

## 5. Implementation plan

Estimates assume one full-time engineer working with me; they are rough sizes, not commitments.

| Phase                         | Deliverables                                                                                                                                                             | Exit criteria                                                                                                                | Est.   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| **1 Architecture**            | ADRs (monolith, queue, ORM, units, determinism, revision storage, match codes), full DB schema + migrations, domain types, monorepo scaffold, CI (lint, typecheck, test) | Schema migrates up/down; CI green; ADRs approved                                                                             | 1 wk   |
| **2 Validation & categories** | Import pipeline (pure part), normalization, all issue codes, eligibility gate, category engine, 2026 rule set                                                            | Golden: 3,154 rows processed; every §6 count reproduced exactly; 28 pair/team entries grouped; categories match evidence     | 1.5 wk |
| **3 Draw engine**             | Pool engine (5 strategies, DP, local search, repair), bracket, byes, seeding/placement, match codes, quality, explanations, calibration script                           | Property tests n = 1…512; determinism replay 100×; semi baseline met on every §8.1 metric; 5,000 entries p95 < 30 s measured | 3 wk   |
| **4 API**                     | Persistence, draw runs via queue, revisions, commands, concurrency, audit, complaints API, RBAC                                                                          | Integration + concurrency tests (parallel conflicting commands); command p95 < 300 ms measured                               | 2 wk   |
| **5 Frontend**                | Participant/data-quality screens, rule editor, draw workspace, drag and drop, lifecycle actions                                                                          | E2E: import → review → draw → move/swap → lock → publish → amend                                                             | 3 wk   |
| **6 Export**                  | PDF bracket/match list/scoresheet, XLSX, freestyle list                                                                                                                  | Visual review against 2026 PDFs; 5,000-entry export < 3 min measured                                                         | 1.5 wk |
| **7 Hardening**               | Load tests (10k entries, 500 pools, 20 arenas), security review, backup/restore drill, runbook                                                                           | Targets met or documented; restore tested                                                                                    | 1.5 wk |

**Total ≈ 13–14 weeks.** Phases 2–3 are pure libraries and can start before the committee answers every question. Only the _defaults_ in the 2026 rule set, and the baseline thresholds, wait on Q-01…Q-04.

---

## 6. Risk register

| ID   | Risk                                                                  | L   | I   | Mitigation                                                                                                           | Trigger / owner                                       |
| ---- | --------------------------------------------------------------------- | --- | --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| K-01 | Committee answers to Q-01…Q-04 differ from inferred rules             | M   | H   | Everything is configuration; engine built rule-agnostic; baseline tests parameterized                                | Answers received → update rule set, rerun calibration |
| K-02 | Heuristic pooling underperforms the committee on some metric          | M   | H   | Five strategies + local search; baseline tests fail the build; exhaustive-search gap measurement on small categories | Phase 3 exit gate                                     |
| K-03 | Hidden nondeterminism (sort stability, floats, JS engine differences) | L   | H   | Integer units, explicit comparators, seeded PRNG, dual-execution fingerprint check, replay tests                     | Any fingerprint mismatch blocks the run               |
| K-04 | Pair/team grouping errors in future imports                           | M   | H   | `entry_group` column; heuristic only proposes; ambiguity blocks                                                      | Import review                                         |
| K-05 | Operators reject the eligibility gate (drew dirty rows in 2026)       | M   | M   | Clear issue explanations, suggested corrections (swap), bulk acknowledge for warnings; errors still block            | Q-10                                                  |
| K-06 | Match codes change after printing                                     | L   | H   | `match_uid` stability, never-reuse registry, amendment notices; tests for command sequences                          | Any code change in a published revision is listed     |
| K-07 | Concurrent editing corrupts a revision                                | L   | H   | Optimistic concurrency + transactional commands; concurrency tests                                                   | `REVISION_CONFLICT` rate metric                       |
| K-08 | Venue network failure during the event                                | M   | M   | Local deployment option; PDF fallback printed at lock/publish                                                        | Runbook                                               |
| K-09 | Personal-data exposure (NIK, birth dates of minors)                   | L   | H   | Encryption, role restriction, export redaction, audit of access                                                      | Security review in Phase 7                            |
| K-10 | Formula injection or value corruption through spreadsheets            | M   | M   | Prefix-neutralization on export; normalization + original preserved on import                                        | Test fixtures with `=`, `+`, `-`, `@` values          |
| K-11 | Scope creep toward scheduling and live scoring                        | M   | M   | Explicitly deferred; MVP gate                                                                                        | Change requests go through ADR                        |
| K-12 | Official weight-class tables unavailable                              | M   | M   | Rule-set editor; import flags unknown classes as ERROR                                                               | Q-12                                                  |
| K-13 | PDF baseline parse error biases acceptance thresholds                 | L   | M   | Thresholds use margins, not exact equality; evidence script reproducible                                             | Recheck if a new PDF set is provided                  |
