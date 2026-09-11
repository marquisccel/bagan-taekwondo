# ADR-0014: Tournament-scoped participant identity and personal-data handling

- Status: Accepted (2026-09-11)

## Context

The data contains names, NIK and birth dates of minors. One person may hold several entries, under
different contingents (F-05, F-06). Cross-tournament identity is not needed for the MVP and would
join personal data across organizers.

## Decision

- `athlete` is a person **within one tournament** (`tournament_id` on every row); cross-tournament
  identity is deferred.
- `entry` references its own `contingent`; `entry_member` links entries to athletes with
  composite foreign keys that force both to belong to the same tournament.
- NIK is stored encrypted (`nik_ciphertext`, AES-256-GCM, key from environment/KMS) with an HMAC
  blind index for de-duplication (`unique (tournament_id, nik_blind_index)`). The original string
  is kept only in the immutable raw import row.
- Registered values (name, gender, birth date, measurements, belt, NIK) are immutable; corrections
  are separate audited records.
- Public exports never contain NIK; birth dates are restricted by role (Phase 4/6).
- Real data lives only in `data/private/` (git-ignored). Golden tests verify its SHA-256 and are
  skipped with a notice if it is absent. Committed fixtures are aggregates (baseline) or fully
  synthetic (5k/10k generator).

## Consequences

- No personal data enters the repository or CI logs.
- Encryption and blind-index keys must be provisioned per deployment (Phase 2 import pipeline).

## Enforced by

`.gitignore` rule for `data/private/*`; composite FKs on `entry_member` and `entry.contingent`;
trigger `athlete_registered_immutable`; baseline export script emits aggregates only
(checked: no id/NIK fields in `committee-2026.json`).
