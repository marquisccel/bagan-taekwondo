# ADR-0005: Stable public match codes

- Status: Accepted (2026-09-11)

## Context

Match numbers (`C017`) are printed and distributed to coaches, arena officials and the public
before the tournament. The 2026 draw numbered matches per arena file (F-39). Renumbering every
match because one athlete moved would invalidate printed schedules.

## Decision

- Separate **internal identity** (`match.id` UUID per revision row; `match_uid` stable across
  revisions) from the **public code** (`public_code`).
- Codes are allocated per arena in schedule order **when a revision is submitted for review**,
  while it is still `DRAFT` (content, including codes, is frozen from `REVIEW` onward).
- `match_code_registry` records `(tournament, public_code) → match_uid`. A code is issued once,
  never deleted, never re-assigned to another match, and can be retired exactly once.
- On a new revision, a match whose `match_uid` survives keeps its code; new matches take the next
  unused code in their arena; removed matches retire their code. The amendment notice lists
  changed, new and retired codes.
- Moving an athlete between existing pools changes slot contents only — no code changes.

## Consequences

- Printed schedules stay valid through most corrections.
- Codes can have gaps after retirements; this is intentional and visible.

## Alternatives rejected

- **Sequential renumbering per revision** — breaks printed material after every correction.
- **Codes derived from position** (arena + round + index) — change whenever pools are re-ordered.

## Enforced by

Trigger `match_code_registry_guard`; primary key `(tournament_id, public_code)`; unique
`(tournament_id, match_uid)`; test "public match codes are never deleted, reused or re-assigned".
The allocation algorithm and its revision-sequence property tests are Phase 3/4 deliverables.
