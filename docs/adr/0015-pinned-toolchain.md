# ADR-0015: Pinned toolchain, upgraded deliberately

- Status: Accepted (2026-09-11)

## Context

In September 2026 several tools had fresh major releases (TypeScript 7 native compiler, Vitest 5,
NestJS 12.0.1, ESLint 10, pnpm 12). A draw system values reproducible builds over the newest
features; a toolchain change can alter emitted code or test behaviour.

## Decision

Exact versions (`save-exact`), chosen for maturity and verified by running the full suite:

| Tool              | Version                           | Why not latest                                                 |
| ----------------- | --------------------------------- | -------------------------------------------------------------- |
| Node.js           | ≥ 22.12 (tested 24.10)            | `require(esm)` needed by the CommonJS API                      |
| pnpm              | 10.34.5                           | 12.x unverified; corepack cache broken on the dev machine      |
| TypeScript        | 5.9.3                             | 7.0 (native) unverified with NestJS decorators and drizzle-kit |
| Vitest            | 3.2.7                             | 5.0 released days before; `projects` API stable in 3.2         |
| fast-check        | 3.23.2                            | stable API                                                     |
| zod               | 4.6.2                             | —                                                              |
| Drizzle ORM / kit | 0.45.2 / 0.31.10                  | —                                                              |
| PGlite            | 0.5.8 (PostgreSQL 18.3)           | test backend only                                              |
| PostgreSQL        | 16 (Docker `postgres:16-alpine`)  | production target                                              |
| NestJS            | 11.2.3                            | 12.0.1 just released                                           |
| Next.js / React   | 16.3.4 / 19.3.0                   | —                                                              |
| ESLint            | 9.39.5 + typescript-eslint 8.70.0 | 10.x plugin support unverified                                 |

Upgrades happen in a dedicated change that re-runs all test tiers, including the determinism
known-answer vectors and the golden dataset.

## Enforced by

`packageManager` field, exact versions in every `package.json`, committed `pnpm-lock.yaml`,
`engine-strict=true`.
