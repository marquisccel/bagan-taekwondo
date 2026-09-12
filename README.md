# BaganTKD — Taekwondo Tournament Draw System

Deterministic, auditable, explainable draw system for Taekwondo tournaments (prestasi and
semi-prestasi, Kyorugi and Poomsae). Current state: **Phase 3 — draw engine, production-ready**
(intake, validation, pooling, brackets, byes, seeds, contingent separation, explainability). No UI
yet. Start with `docs/PHASE3_RUNBOOK.md` and `docs/ENGINE_CONTRACT.md`.

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
