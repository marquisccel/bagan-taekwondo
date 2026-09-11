# ADR-0011: Registration vs eligibility status; explicit Technical Delegate overrides

- Status: Accepted (2026-09-11)

## Context

24 rows of the 2026 data have unusable measurements; the committee drew them anyway (F-29).
The new system blocks such entries — but a Technical Delegate must be able to accept a known risk
(e.g. a re-measured height) explicitly. Also, "verified" registration does not imply that an
entry can be drawn under the current rules.

## Decision

**Two independent statuses on `entry`:**

| RegistrationStatus (administrative)                | EligibilityStatus (draw)                  |
| -------------------------------------------------- | ----------------------------------------- |
| `REGISTERED → VERIFIED → WITHDRAWN / DQ / NO_SHOW` | `BLOCKED`, `READY`, `OVERRIDDEN`, `DRAWN` |

`deriveEligibility` is total and pure: terminal registration, an open blocking issue, a rule gap
or an unconfirmed entry group ⇒ `BLOCKED`; otherwise `DRAWN` if in a locked revision, else
`OVERRIDDEN` if any ERROR is covered by an override, else `READY`. An entry relying on an
override is never shown as plain `READY`.

**Overrides (`data_quality_override`):**

- Only an actor with `TECHNICAL_DELEGATE` in the issue's tournament; only `ERROR` severity; only
  codes marked overridable; only `OPEN` issues; reason ≥ 15 characters.
- Not overridable: issues that make the draw structurally unsafe (`UNKNOWN_CLASS`, `UNKNOWN_BELT`,
  `HEIGHT_MISSING`, `ENTRY_GROUP_*`, …). Overriding them would make the draw silent, not safe.
- Inserting an override sets the issue to `OVERRIDDEN`; a revocation (actor, reason) reopens it.
  Overrides are never edited or deleted. Each produces an audit event.
- Corrections are separate: `measurement_correction` stores original and corrected value, actor
  and reason; registered values themselves are immutable.

## Consequences

- No silent bypass exists: the only way past an ERROR is an attributable, reasoned, revocable
  record.
- Reports distinguish READY from OVERRIDDEN entries.

## Enforced by

- Triggers `data_quality_override_guard`, `data_quality_override_sync_issue`,
  `athlete_registered_immutable`, `entry_registration_guard`; check
  `entry_terminal_not_placeable_ck`.
- SQL `issue_code_overridable()` parity test against the TypeScript issue catalog.
- Property tests for `deriveEligibility`; domain tests for `validateOverride`.
