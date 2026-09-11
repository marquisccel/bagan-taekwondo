# Phase 1 Report — Foundations

| | |
|---|---|
| Date | 2026-09-11 |
| Scope | Monorepo scaffold, database schema + migrations, domain model, ADRs, rule-set model, test infrastructure, draw simulator skeleton |
| Out of scope (by design) | Engine algorithms (Phase 3), import pipeline (Phase 2), API commands (Phase 4), UI (Phase 5) |
| Result | All Phase 1 criteria of `ACCEPTANCE_CRITERIA.md` §5 met |

## 1. Deliverables

| Requested output | Where | Notes |
|---|---|---|
| Monorepo scaffold | `package.json`, `pnpm-workspace.yaml`, `tsconfig.*.json`, `apps/*`, `packages/*`, `tools/*` | pnpm 10 workspaces, TS project references, strict mode incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Database schema | `packages/db/src/schema/*.ts` | 49 tables, 41 enums (generated from domain arrays), 78 CHECK constraints |
| Migrations | `packages/db/migrations/0000_core_schema.sql` (865 lines), `0001_invariant_triggers.sql` (430 lines) | 38 triggers; applied on PostgreSQL 16.15 and PGlite (PostgreSQL 18.3) |
| Domain model | `packages/domain/src/*`, `docs/DOMAIN_MODEL.md` | Units, enums, revision lifecycle, registration vs eligibility, entry-group provenance, issue catalog, overrides, commands, complaints |
| ADRs | `docs/adr/0001…0015` | Each lists how it is enforced |
| Rule-set model | `packages/rules/src/schema.ts`, `readiness.ts`, `fixtures/rulesets/piala-gubernur-2026.provisional.json` | Provenance on every decision; purpose-specific readiness |
| Test infrastructure | `vitest.config.ts` (unit / property / golden / db), `packages/db/src/testing/test-db.ts`, `fixtures/datasets/manifest.json` | fast-check; dual DB backend; SHA-256-verified private golden data |
| Draw simulator skeleton | `tools/draw-simulator` | CLI `simulate` / `synthetic`; multi-seed, replay, baseline comparison, deterministic report |
| Extras | `apps/api` (health endpoints), `apps/worker`, `apps/web` (placeholder), `docker-compose.yml`, `.github/workflows/ci.yml`, `eslint.config.js` | UI deliberately minimal per product-owner instruction |

## 2. Verification

All commands run on 2026-09-11, Windows 11, Node 24.10.0, Docker Desktop.

| Check | Command | Result |
|---|---|---|
| Build + typecheck (sources, tests, API, web) | `pnpm typecheck` | exit 0 |
| Lint (strict type-checked + determinism rules) | `pnpm lint` | exit 0 |
| Determinism rules actually fire | probe file with `Math.random`, `Date.now`, `new Date`, `localeCompare` | 4 errors, as intended |
| Formatting | `pnpm format:check` | clean |
| Full test suite, PostgreSQL 16 attached | `DATABASE_URL=… pnpm test` | **13 files, 172 tests passed** |
| API smoke test | start API, stop/start PostgreSQL | `/health/live` 200 throughout; `/health/ready` 200 → 503 (DB down) → 200 (DB back, no restart) |
| Simulator on real 2026 data | `simulate … --seeds range:1..20` | 3,154 rows; 21 seeds; replay identical; 0 invariant violations; engine refuses with `ENGINE_STAGE_NOT_IMPLEMENTED`; 7 lock blockers reported |

### Test results by file

| Tier | File | Tests |
|---|---|---|
| unit | `packages/shared/src/prng.test.ts` — known-answer vectors from an independent Python implementation | 16 |
| unit | `packages/shared/src/canonical-json.test.ts` — canonical form, reference fingerprint, strict rejection | 10 |
| unit | `packages/shared/src/fixed-point.test.ts` — fixed point, deterministic UUID, comparators | 8 |
| property | `packages/shared/src/prng.property.test.ts` — replay for any 64-bit seed, bounds, permutations | 3 |
| unit | `packages/domain/src/domain.test.ts` — units, entry groups, overrides, complaints | 27 |
| property | `packages/domain/src/state-machines.property.test.ts` — lifecycle, registration, eligibility | 7 |
| unit | `packages/rules/src/readiness.test.ts` — provisional set allowed/refused per purpose, structural errors, fingerprint | 11 |
| unit | `packages/draw-engine/src/run.test.ts` — honest refusal, version/assumption guards, INV-05, INV-02/03 checker | 7 |
| db | `packages/db/src/schema.db.test.ts` — every invariant on **both** PGlite and PostgreSQL 16 (28 × 2) | 56 |
| unit | `tools/draw-simulator/src/csv.test.ts` — RFC 4180, missing final newline, BOM, formula neutralization | 10 |
| unit | `tools/draw-simulator/src/simulator.test.ts` — synthetic determinism + pinned fingerprints, simulation, baseline logic | 11 |
| golden | `tools/draw-simulator/src/real-2026.golden.test.ts` — SHA-256, 3,154 × 13, deterministic 21-seed simulation | 3 |
| unit | `apps/api/src/readiness.test.ts` — readiness, timeouts, pool-error regression | 3 |
| | **Total** | **172** |

### Database invariants proven on both backends

Append-only audit with fork-proof hash chain · registered values immutable · corrections
append-only with reason · registration transitions = TypeScript · withdrawn entry never eligible ·
heuristic group needs a confirmer · override only by Technical Delegate / only ERROR / only
overridable codes · override syncs issue status and is revocable, never editable · SQL overridable
list = TypeScript catalog · tolerance max UNSET/NONE/SET coherence · activated rule set frozen ·
candidate run cannot carry assumptions · SAFE candidate needs matching dual run · finished run
immutable · one selected strategy, never with hard violations · entry once per revision · bracket
structure · lifecycle transitions = TypeScript · lock_version must increment · content frozen
outside DRAFT · official revision must be PUBLISHED · match codes never deleted/reused/reassigned
· commands idempotent and append-only · accepted complaint must reference its resolution · no
CHECK bypass through NULL.

## 3. Defects found and fixed during Phase 1

The verification steps found real defects. Each is fixed and, where it could recur, has a
regression test.

| # | Defect | Found by | Fix |
|---|---|---|---|
| 1 | Three timestamp columns silently named `created_at` (`requested_at`, `granted_at`, `published_at`) through a helper | trigger referencing `requested_at` failed | `nowTs(name)` helper; migrations regenerated |
| 2 | Four CHECK constraints passable with NULL (SAFE run without dual-run flag; audit chain key with null tournament; override revoked without reason; elimination template without bronze count) | db test on both backends | `IS TRUE` / `coalesce` / explicit `IS NOT NULL`; 4 regression tests |
| 3 | API process crashed when PostgreSQL restarted (unhandled `pg.Pool` `'error'` event) | smoke test | pool error handler + shutdown hook; regression test |
| 4 | Test files were never typechecked (Vitest does not typecheck) | ESLint project service | `tsconfig.lint.json`; `pnpm typecheck` now covers tests |
| 5 | Vitest `fileParallelism` in a project config was silently ignored | typechecking the config | removed |
| 6 | Raw NUL and BOM characters written into source files by the editing tool | byte inspection | escapes / `String.fromCharCode`; repo-wide scan clean |
| 7 | Synthetic generator gave the dominant contingent 12% instead of the observed ~27% | distribution check | recalibrated; fingerprints re-pinned |
| 8 | A test used a `JSON.stringify` replacer array that dropped nested keys | failing test | deep key-reversal helper |

## 4. What the engine does today

`runDraw` accepts the final input/output contract and returns `UNSAFE` with
`ENGINE_STAGE_NOT_IMPLEMENTED` for every run. This is intentional: the simulator, replay checks,
baseline comparison and reports already work end to end, and the engine cannot produce a draw
until its stages exist and pass their tests.

## 5. Open items

| Item | Owner | Blocks |
|---|---|---|
| Maximum height/weight/belt tolerances (Q-02) | Committee | LOCK only |
| Medal structure per semi-prestasi pool (Q-01 detail) | Committee | LOCK only |
| Official weight-class tables (observed subsets now) | Committee | LOCK warning |
| Q-06 … Q-17 (contingent identity, play-up, weigh-in, prestasi seeding, deployment, …) | Committee | Defaults in place; none blocks Phase 2 |
| Entry/team id in the registration export (Q-12) | Registration system | Removes the pair/team heuristic |
| pg-boss wiring, NIK encryption keys | Engineering | Phase 2 (keys), Phase 4 (queue) |
| Repository not yet under version control | Product owner | — (no commit made without your instruction) |

## 6. Next

**Phase 2 — validation, normalization, categories.** The exact expected counts on the 2026 data
(3,121 persons, 3,115 entries, 28 entry groups, 238 categories, every issue count) are fixed in
`ACCEPTANCE_CRITERIA.md` §5, computed independently beforehand.

**Phase 3 — draw engine**, gated by the nine criteria in §5; the operator UI starts only after that
gate.
