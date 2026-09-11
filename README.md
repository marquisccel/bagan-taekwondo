# BaganTKD — Taekwondo Tournament Draw System

Deterministic, auditable, explainable draw system for Taekwondo tournaments (prestasi and
semi-prestasi, Kyorugi and Poomsae). Current phase: **1 — foundations** (engine contract,
schema, rule-set model, simulator skeleton). See `docs/PHASE1_REPORT.md`.

## Documents

| Document                      | Content                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `docs/SOURCE_ANALYSIS.md`     | Evidence from the 2026 data and printed draw; facts, rules, contradictions, questions |
| `docs/PHASE0_PROPOSAL.md`     | Architecture, domain, algorithm, plan (superseded where an ADR differs)               |
| `docs/adr/`                   | Architecture decision records 0001–0015                                               |
| `docs/DOMAIN_MODEL.md`        | Entity diagram, state machines, rule-set model                                        |
| `docs/ACCEPTANCE_CRITERIA.md` | Safety invariants (correctness) vs quality benchmark; test matrix; phase gates        |
| `docs/PHASE1_REPORT.md`       | What Phase 1 delivered and how it was verified                                        |

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

Draw simulator:

```bash
cd tools/draw-simulator
npx tsx --conditions=source src/cli.ts simulate \
  --dataset "../../data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv" \
  --rules ../../fixtures/rulesets/piala-gubernur-2026.provisional.json \
  --baseline ../../fixtures/baselines/committee-2026.json \
  --seeds range:1..20 --golden-seed 20260827 --out ../../out/simulations
npx tsx --conditions=source src/cli.ts synthetic --rows 5000 --seed 5000 \
  --rules ../../fixtures/rulesets/piala-gubernur-2026.provisional.json --out synthetic-5k.csv
```

## Private data

`data/private/` holds real registration data of minors and is git-ignored. See `data/README.md`.
