# BaganTKD — Taekwondo Tournament Draw System

Deterministic, auditable, explainable draw system for Taekwondo tournaments (prestasi and
semi-prestasi, Kyorugi and Poomsae): intake, validation, pooling, brackets, byes, seeds, contingent
separation, explainability, a review/editing web UI, and PDF/XLSX export.

## Cara jalanin (buat tim)

**Sekali di awal, per komputer:**

1. Install & buka [Docker Desktop](https://www.docker.com/products/docker-desktop/) — biarkan tetap
   jalan (cukup ikon di tray, gak perlu dibuka window-nya).
2. Install [Node.js](https://nodejs.org/) versi 22 ke atas.
3. `git clone` repo ini, lalu masuk ke foldernya.

**Tiap mau jalanin proyeknya:**

```bash
pnpm dev
```

Cuma itu. Satu perintah ini otomatis: nyalain database, (run pertama doang) install semua dependency
dan download Chromium buat export PDF, build, jalanin migration, lalu jalanin API + worker + web
app-nya bareng di satu terminal. Run pertama agak lama (beberapa menit, karena instalasi); run
berikutnya cepat.

Begitu muncul baris `web app: http://localhost:3001`, buka **http://localhost:3001** — pakai
`localhost`, bukan `127.0.0.1` atau alamat IP lain (lihat bagian Troubleshooting kalau lupa kenapa).

Buat berhenti: tekan **Ctrl+C sekali** di terminal itu.

Lebih suka 3 jendela terpisah (API/worker/web masing-masing punya jendela sendiri) daripada satu
terminal gabungan? Di Windows, jalanin `powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1`
(berhenti dengan `scripts/stop-all.ps1`).

### Troubleshooting

- **Buka `localhost:3001`, jangan `127.0.0.1` atau alamat IP lain.** API cuma izinin origin
  `localhost`/`127.0.0.1`; alamat lain bikin semua request ke API gagal diam-diam (CORS), biasanya
  kelihatan sebagai "Failed to fetch" atau tombol yang seperti tidak melakukan apa-apa.
- **Abis ambil (`git pull`) perubahan terbaru, restart `pnpm dev` dari nol** — tekan Ctrl+C, tunggu
  sampai bener-bener berhenti, baru jalanin `pnpm dev` lagi. Proses lama yang masih jalan gak otomatis
  kebaca kode barunya, meskipun file di disk sudah ke-build ulang.
- **Docker belum nyala** → `pnpm dev` akan gagal di langkah "start PostgreSQL". Buka Docker Desktop
  dulu, tunggu sampai statusnya running, baru coba lagi.
- Error lain saat `pnpm dev`? Baca baris `[setup]` paling akhir di terminal — tiap langkah dicetak
  dengan jelas (`scripts/dev.mjs`), jadi biasanya langsung kelihatan langkah mana yang gagal.

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
docs/         Design/acceptance docs (table below)
data/         Private tournament data (git-ignored) — see data/README.md
```

## Private data

`data/private/` holds real registration data of minors and is git-ignored. See `data/README.md`.
Generated export files (`var/`) and the local `.env` (NIK encryption keys) are also git-ignored —
double-check `git status` before staging if you're unsure whether something should be committed.

---

## For contributors: deeper technical detail

### Requirements

- Node.js ≥ 22.12 (tested on 24.10), pnpm 10.34.5 (`npx -y pnpm@10.34.5` works without a global install)
- Docker (PostgreSQL 16) for database tests against a real server; PGlite covers the rest
- Python 3.11+ with `pymupdf` only for `tools/source-analysis`

### Commands

```bash
pnpm install
pnpm typecheck          # build + typecheck sources, tests, API, web
pnpm lint               # strict type-checked ESLint + determinism rules
pnpm format             # prettier --write .
pnpm format:check       # prettier --check . (what CI runs)
pnpm test               # all tiers (golden skipped with a notice if data/private is absent)
docker compose up -d postgres
DATABASE_URL=postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd pnpm test:db
pnpm --filter @bagantkd/db migrate          # apply migrations to DATABASE_URL
```

Before pushing, run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:unit` locally —
these are exactly what CI checks, and CI fails the whole pipeline (no test results at all) if
`format:check` fails first.

Draw engine demonstrations (simulate 2026, replay, 2026/5K/10K benchmarks): see `docs/PHASE3_RUNBOOK.md`.

### Documents

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
