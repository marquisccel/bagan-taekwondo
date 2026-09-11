# ADR-0010: Pair/team grouping carries provenance and must be confirmed

- Status: Accepted (2026-09-11)

## Context

The 2026 export has one row per person and **no entry identifier** (F-03). Pairs (one male + one
female) and teams (three of one gender) could be reconstructed only by heuristic (same contingent

- category + composition). That worked for all 17 pairs and 11 teams in 2026, but a contingent
  entering two pairs in the same category would be ambiguous.

## Decision

`entry_group` records, per pair/team entry:

| Field             | Values                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`          | `EXPLICIT` (registration system's entry id), `IMPORTED` (operator grouping column in the uploaded file), `HEURISTIC` (system inference), `MANUAL` (operator in the app) |
| `status`          | `PROPOSED`, `CONFIRMED`, `REJECTED`                                                                                                                                     |
| `confidence`      | `HIGH`, `MEDIUM`, `LOW`                                                                                                                                                 |
| `evidence`        | JSON: rule used, candidates considered                                                                                                                                  |
| `confirmed_by/at` | the person who confirmed                                                                                                                                                |

- `HEURISTIC` groups start `PROPOSED`; they become usable only when a person confirms them.
- An entry is `DRAW_ELIGIBLE` only if its group is final (`isEntryGroupFinal`).
- Ambiguous or incomplete compositions raise `ENTRY_GROUP_AMBIGUOUS` / `ENTRY_GROUP_INCOMPLETE`
  (ERROR, not overridable).
- Composition rules (pair = 1F + 1M, team = 3 of one gender) are rule-set values.

## Consequences

- A pair can never enter a bracket as two independent competitors, and never by an unconfirmed
  guess.
- The registration export should add an entry/team id (Q-12); until then operators confirm.

## Enforced by

- DB checks `entry_group_confirmation_ck`, `entry_group_heuristic_start_ck`; test "a heuristic
  group cannot be confirmed without a confirming person".
- Domain tests for `isEntryGroupFinal` and `checkComposition`.
