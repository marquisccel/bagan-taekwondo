# BaganTKD — Taekwondo Tournament Draw System

Deterministic, auditable, explainable draw system for Taekwondo tournaments (prestasi and
semi-prestasi, Kyorugi and Poomsae): intake, validation, pooling, brackets, byes, seeds, contingent
separation, explainability, a review/editing web UI, and PDF/XLSX export. Start with
`docs/PHASE3_RUNBOOK.md` and `docs/ENGINE_CONTRACT.md` for the draw engine specifically.

## Quick start (local machine)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) running and
[Node.js](https://nodejs.org/) installed. One command starts everything — PostgreSQL, the API, the
background worker, and the web app — in a single terminal:

```bash
pnpm dev
```

Wait about 10-15 seconds, then open **http://localhost:3001** in your browser (use that exact
hostname, not `127.0.0.1` and not a LAN/IP address — the API only allows the web app's own
`localhost`/`127.0.0.1` origins, so opening it via any other address silently breaks every API call
with a CORS failure; see `scripts/dev.mjs` for why). Press **Ctrl+C once** to stop all three
services. First run installs dependencies and builds the API/worker, so it takes a little longer;
later runs are quick. See `scripts/dev.mjs` for what each step does.

Prefer three separate windows (one per service, e.g. to `Ctrl+C` just one of them) instead of one
merged terminal? On Windows, run `powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1`
instead (stop with `scripts/stop-all.ps1`).

### First run only: PDF export needs a Chromium download

PDF exports (`packages/export`) render through headless Chromium via Playwright, which isn't
downloaded by `pnpm install`. Before exporting a PDF for the first time, run:

```bash
pnpm --filter @bagantkd/export exec playwright install chromium
```

Without this, a PDF export request fails with `EXPORT_GENERATION_FAILED`.

## Documents

| Document                      | Content                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `docs/SOURCE_ANALYSIS.md`     | Evidence from the 2026 data and printed draw; facts, rules, contradictions, questions |
| `docs/PHASE0_PROPOSAL.md`     | Architecture, domain, algorithm, plan (superseded where an ADR differs)               |
| `docs/adr/`                   | Architecture decision records 0001–0015                                               |
| `docs/DOMAIN_MODEL.md`        | Entity diagram, state machines, rule-set model                                        |
| `docs/ACCEPTANCE_CRITERIA.md` | Safety invariants (correctness) vs quality benchmark; test matrix; phase gates        |
| `docs/PHASE1_REPORT.md`       | What Phase 1 delivered and how it was verified                                        |
| `docs/PHASE2_GATE_REPORT.md`  | Intake, validation, normalization, categories: gate evidence                          |
| `docs/ENGINE_CONTRACT.md`     | Frozen draw-engine contract: input, output, failures, limits, determinism, versioning |
| `docs/PHASE3_CALIBRATION.md`  | Algorithmic decisions and measured tradeoffs                                          |
| `docs/PHASE3_GATE_REPORT.md`  | Draw-engine acceptance evidence                                                       |
| `docs/PHASE3_RUNBOOK.md`      | Clean-checkout commands: install, test, simulate, replay, benchmarks                  |
| `docs/UAT_RUNBOOK.md`         | User-acceptance test script for the operator web UI                                   |

## Project layout

```
apps/
  api/        NestJS HTTP API
  web/        Next.js operator UI
  worker/     pg-boss background job worker (draw runs, exports)
packages/
  db/         Drizzle schema, migrations, repositories (Postgres)
  domain/     Pure business rules (RBAC, command policy, export policy)
  draw-engine/  The deterministic draw/bracket algorithm
  export/     PDF (Playwright/HTML) and XLSX document rendering
  intake/     SPS spreadsheet parsing/normalization
  rules/      Rule-set (belts, age divisions, weight classes) readiness checks
  shared/     Cross-package utilities (hashing, canonical JSON, PRNG, match numbering)
docs/         Design/acceptance docs (table above)
data/         Private tournament data (git-ignored) — see data/README.md
```

## Requirements

- Node.js ≥ 22.12 (tested on 24.10), pnpm 10.34.5 (`npx -y pnpm@10.34.5` works without a global install)
- Docker (PostgreSQL 16) for database tests against a real server; PGlite covers the rest
- Python 3.11+ with `pymupdf` only for `tools/source-analysis`

## Commands

```bash
pnpm install
pnpm typecheck          # build + typecheck sources, tests, API, web
pnpm lint               # strict type-checked ESLint + determinism rules
pnpm test               # all tiers (golden skipped with a notice if data/private is absent)
docker compose up -d postgres
DATABASE_URL=postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd pnpm test:db
pnpm --filter @bagantkd/db migrate          # apply migrations to DATABASE_URL
```

Draw engine demonstrations (simulate 2026, replay, 2026/5K/10K benchmarks): see `docs/PHASE3_RUNBOOK.md`.

## Private data

`data/private/` holds real registration data of minors and is git-ignored. See `data/README.md`.
Generated export files (`var/`) and the local `.env` (NIK encryption keys) are also git-ignored —
double-check `git status` before staging if you're unsure whether something should be committed.
