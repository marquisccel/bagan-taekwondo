# Phase 2 Plan — Validation, Normalization, Categories

|          |                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Status   | Plan, written before implementation (2026-09-11)                                                                                     |
| Inputs   | ACCEPTANCE_CRITERIA §5 (expected values — not to be changed), ADR-0007/0010/0011/0012/0014, product-owner instructions of 2026-09-11 |
| Stops at | The Phase 2 exit gate (§9). Phase 3 does not start automatically.                                                                    |

**Primary rule.** Observed 2026 behaviour is `EVIDENCE_2026`; official rules are `COMMITTEE`
configuration. Nothing in this phase turns an observation into a universal rule. Where the
pipeline needs a rule the committee has not given, it uses a rule-set value with explicit
provenance, or it raises a structured issue.

## 1. Pipeline architecture

```
CSV bytes
  │ parse (RFC 4180)                                  → RawRow[]           verbatim strings + row number
  │ map (source adapter "kolektif-2026")              → SourceRecord[]     named fields, still raw
  │ normalize (per field)                             → NormalizedRow[]    Trace<T> per field
  │ validate (row rules)                              → Issue[] (row)
  │ resolve persons (entity resolution)               → Person[]  + Issue[] (person)
  │ reconstruct entries (individual / pair / team)    → Entry[] + EntryGroup[] + Issue[] (entry)
  │ derive categories (pure, rule-set driven)         → Category[] + rule gaps
  │ severity by usage → eligibility (derived)         → Eligibility per entry
  │ snapshot (canonical, fingerprinted)               → IntakeSnapshot
  └ report                                            → TransformationReport, DifferentialReport
```

| Component                                                                                                     | Location                                      | Nature                                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Parsing, mapping, normalization, validation, resolution, grouping, categories, eligibility, snapshot, reports | `packages/intake` (new)                       | pure, deterministic, no I/O                                   |
| Persistence of batches, rows, transformations, issues, persons, entries, groups, snapshots                    | `packages/db` (repository + migration `0002`) | transactional                                                 |
| Engine stages `normalizeEntries`, `validateEntries`, `gateEligibility`, `buildCategories`                     | `packages/draw-engine`                        | pure; re-derives categories from the snapshot, trusts nothing |
| Independent baseline                                                                                          | `tools/phase2-baseline/baseline.py`           | Python, no shared code                                        |
| Differential + transformation reports                                                                         | `tools/draw-simulator intake-report`          | CLI                                                           |

Every stage returns data plus issues; no stage throws for bad data. A stage throws only for
programming errors (violated internal invariants).

**Pipeline invariant.** Every raw row ends in exactly one of: one entry, or the list of
unresolved rows with a blocking issue. Nothing is dropped.

## 2. RAW → NORMALIZED → RESOLVED

Every field of every row carries a trace:

```ts
interface Trace<T> {
  raw: string; // exactly as received, never modified
  value: T | null; // canonical value, null if unusable
  outcome: 'UNCHANGED' | 'MAPPED' | 'NORMALIZED' | 'INVALID';
  rule: string; // e.g. CLASS_FORMULA_PREFIX, VOCAB_GENDER, NIK_TRAILING_PUNCTUATION
  provenance: 'COMMITTEE' | 'STAKEHOLDER' | 'EVIDENCE_2026' | 'ENGINEERING_DEFAULT' | 'TBD';
  suggestion: { value: string; rule: string; evidence: object } | null;
}
```

- `UNCHANGED` — raw already canonical. `MAPPED` — vocabulary lookup (e.g. `Laki-laki` → `MALE`).
  `NORMALIZED` — format changed without changing meaning (`=+53` → `+53`, trailing `.` on NIK,
  collapsed whitespace). `INVALID` — cannot be used; an issue is raised.
- A **suggestion** is never applied by the pipeline (e.g. height/weight swap, `53` → `+53`/`-53`).
- Persistence: `import_row.raw` (immutable), `import_row.normalized` (full trace, written once),
  and one `field_transformation` row for every `NORMALIZED`, `INVALID` or suggestion, carrying
  raw, normalized, suggested value, rule, provenance and a resolution record
  (`PENDING` / `NOT_REQUIRED` / `ACCEPTED` / `REJECTED` + resolver, reason, timestamp). A
  resolution can be recorded once; raw and normalized values never change.
- `MAPPED` traces stay in `import_row.normalized` only (one per field per row would be ~16,000
  rows of noise); they are counted in the transformation report.

## 3. Normalization rules

Key normalization for vocabulary lookups: trim, collapse internal whitespace to one space,
upper-case. Vocabulary keys in the rule set are normalized the same way.

| Field (source column)          | Accepted raw                                                         | Canonical                                                  | Outcomes / issues                                                                                                                                                                                                                                       | Provenance                                                 |
| ------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `id_athlete`                   | non-empty string                                                     | trimmed                                                    | empty or duplicate in batch → `DUPLICATE_SOURCE_ID` (ERROR)                                                                                                                                                                                             | ENGINEERING_DEFAULT                                        |
| `namalengkap`                  | any                                                                  | trimmed, internal whitespace collapsed; **case preserved** | changed → `NORMALIZED` (`NAME_WHITESPACE`); empty → `NAME_MISSING` (ERROR)                                                                                                                                                                              | ENGINEERING_DEFAULT                                        |
| `jeniskelamin`                 | vocabulary key                                                       | `MALE` / `FEMALE`                                          | `MAPPED`; unknown → `UNKNOWN_GENDER` (ERROR)                                                                                                                                                                                                            | rule-set vocabulary                                        |
| `tanggallahir`                 | `YYYY-MM-DD`, real calendar date                                     | ISO date                                                   | other → `INVALID_DATE` (ERROR)                                                                                                                                                                                                                          | ENGINEERING_DEFAULT                                        |
| `tinggibadan`                  | decimal cm, `.` or `,`                                               | integer mm                                                 | `0`/empty → value null + `HEIGHT_MISSING`; non-numeric → `INVALID_NUMBER`; sub-mm precision → rounded half-up, `NORMALIZED` (`HEIGHT_ROUNDED_TO_MM`)                                                                                                    | ENGINEERING_DEFAULT                                        |
| `beratbadan`                   | decimal kg                                                           | integer g                                                  | `0`/empty → null + `WEIGHT_MISSING`; non-numeric → `INVALID_NUMBER`; sub-gram → rounded, `NORMALIZED`                                                                                                                                                   | ENGINEERING_DEFAULT                                        |
| `sabuk`                        | a belt `sourceLabel`                                                 | belt code                                                  | `MAPPED`; unknown → `UNKNOWN_BELT` (ERROR)                                                                                                                                                                                                              | rule-set belts                                             |
| `klasifikasi`                  | vocabulary key                                                       | stream + discipline                                        | unknown → `UNKNOWN_CLASSIFICATION` (ERROR)                                                                                                                                                                                                              | rule-set vocabulary                                        |
| `divisi`                       | vocabulary key                                                       | division code, must belong to the stream                   | unknown / wrong stream → `UNKNOWN_DIVISION` (ERROR)                                                                                                                                                                                                     | rule-set vocabulary                                        |
| `class` (format)               | `INDIVIDUAL` / `PAIR` / `TEAM`                                       | entry format                                               | `MAPPED`                                                                                                                                                                                                                                                | rule-set vocabulary                                        |
| `class` (Kyorugi weight class) | `-NN`, `+NN` canonical; `=+NN`, `=-NN`, `NN+`, `−NN` (Unicode minus) | `-NN` / `+NN`                                              | variant → `NORMALIZED` + `CLASS_FORMAT_NORMALIZED` (INFO); bare `NN` → `AMBIGUOUS_WEIGHT_CLASS` (ERROR) with suggestions `-NN` / `+NN` (spreadsheet formula corruption, F-37); anything else, or a code absent from the table → `UNKNOWN_CLASS` (ERROR) | ENGINEERING_DEFAULT (format) + rule-set tables (existence) |
| `nik`                          | digits                                                               | trailing `. , ; :` and whitespace removed                  | stripped → `NORMALIZED` + `NIK_NORMALIZED` (INFO); empty → `NIK_MISSING` (WARNING); not 16 digits → `NIK_INVALID_FORMAT` (WARNING)                                                                                                                      | ENGINEERING_DEFAULT                                        |
| `tim_kontingen`                | any                                                                  | trimmed, whitespace collapsed                              | `nama_tim` ≠ `tim_kontingen` → `CONTINGENT_FIELDS_DIFFER` (WARNING)                                                                                                                                                                                     | ENGINEERING_DEFAULT                                        |

No normalization changes meaning. Anything that would change meaning is a suggestion.

## 4. Validation rules

**Severity by usage.** A physical-data issue is `ERROR` when the entry's category template uses
the field, otherwise `INFO` (recorded, irrelevant to that draw). A field is _used_ when:

| Field      | Used by                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| height     | pooled templates whose pool policy has an **active** HEIGHT tolerance    |
| weight     | pooled templates whose pool policy has an **active** WEIGHT tolerance    |
| belt       | templates with a `MOVEMENT` dimension, or pool policy belt `HARD`/`SOFT` |
| birth date | every template (age division)                                            |

With the provisional rule set: Kyorugi semi uses height, weight, belt; Poomsae semi uses height
and belt (weight disabled, Q5); prestasi and freestyle use none of the three.

**Plausibility** (rule-set `plausibility`, ENGINEERING_DEFAULT): height 900–2100 mm, weight
12,000–130,000 g, BMI 11.0–40.0 (compared exactly as `w·10⁴ ∉ [110·h², 400·h²]`, integers).

| Code                                                             | Predicate (row level unless stated)                                                                                                                                                                   | Default severity                                                                                                                                                      | Count unit  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `HEIGHT_MISSING` / `WEIGHT_MISSING`                              | value 0 or empty                                                                                                                                                                                      | by usage                                                                                                                                                              | row         |
| `HEIGHT_WEIGHT_LIKELY_SWAPPED`                                   | both present; height **or** weight implausible; **and** weight read as cm is a plausible height **and** height read as kg is a plausible weight. Suggestion: swap. _(Corrected 2026-09-11, see §12.)_ | by usage (either field used ⇒ ERROR)                                                                                                                                  | row         |
| `HEIGHT_OUT_OF_RANGE`                                            | present, implausible, not a swap                                                                                                                                                                      | by usage                                                                                                                                                              | row         |
| `WEIGHT_OUT_OF_RANGE`                                            | present, implausible, not a swap                                                                                                                                                                      | by usage                                                                                                                                                              | row         |
| `BMI_IMPLAUSIBLE`                                                | height and weight both present and plausible; BMI outside range                                                                                                                                       | WARNING                                                                                                                                                               | row         |
| `WEIGHT_CLASS_MISMATCH`                                          | Kyorugi; weight usable; declared class known; weight ∉ (lower, upper] of the rule-set table. Params include the table's `completeness`.                                                               | WARNING                                                                                                                                                               | row         |
| `AGE_DIVISION_PLAY_UP`                                           | birth year later than the declared division's band, and the division that contains the birth year (same stream) is exactly one `order` below                                                          | WARNING                                                                                                                                                               | row         |
| `AGE_DIVISION_CONFLICT`                                          | birth year earlier than the band, or more than one division below, or no division of the stream contains it                                                                                           | ERROR (overridable)                                                                                                                                                   | row         |
| `NIK_GENDER_MISMATCH`                                            | valid 16-digit NIK; day field > 40 ⇔ female disagrees with gender                                                                                                                                     | WARNING                                                                                                                                                               | row         |
| `NIK_BIRTHDATE_MISMATCH`                                         | valid NIK; `YYMMDD` (day − 40 for women) disagrees with birth date; param `component` = `YEAR` or `DAY_MONTH`                                                                                         | WARNING                                                                                                                                                               | row         |
| `DOB_POSSIBLE_PLACEHOLDER`                                       | birth date is 1 January                                                                                                                                                                               | INFO                                                                                                                                                                  | row         |
| `ATHLETE_ATTRIBUTE_CONFLICT`                                     | same person, different name (case-insensitive, whitespace-normalized) / gender / birth date / height / weight / belt across rows                                                                      | name, gender or birth-date conflict: always ERROR (identity conflict); height / weight / belt conflict: ERROR for entries whose template uses the field, else WARNING | person      |
| `ATHLETE_MULTIPLE_CONTINGENTS`                                   | same person under > 1 contingent                                                                                                                                                                      | INFO                                                                                                                                                                  | person      |
| `POSSIBLE_DUPLICATE_PERSON`                                      | different person keys, same case-folded name and birth date                                                                                                                                           | WARNING                                                                                                                                                               | person pair |
| `ENTRY_GROUP_AMBIGUOUS` / `ENTRY_GROUP_INCOMPLETE`               | see §6                                                                                                                                                                                                | ERROR, not overridable                                                                                                                                                | row         |
| `ENTRY_GROUP_UNCONFIRMED`                                        | pair/team group not `CONFIRMED`                                                                                                                                                                       | ERROR, not overridable                                                                                                                                                | entry       |
| `NO_CATEGORY_TEMPLATE` / `MOVEMENT_UNRESOLVED` / `UNKNOWN_CLASS` | rule gaps in §7                                                                                                                                                                                       | ERROR (rule gap)                                                                                                                                                      | entry       |

`NIK_BIRTHDATE_MISMATCH` stays a WARNING even when the NIK year would imply another division:
the NIK itself can be the typo, and escalating it is a committee decision (recorded as an
assumption, §10).

**Weight-class tables (instruction 9).** The provisional tables are `OBSERVED_SUBSET` /
`EVIDENCE_2026`. They are used to recognize declared classes and to compute
`WEIGHT_CLASS_MISMATCH`, but they are not official: every mismatch issue carries
`tableCompleteness`, and rule-set readiness keeps `WEIGHT_CLASS_TABLE_NOT_OFFICIAL` as a lock
warning. For 2026, `UNKNOWN_CLASS = 0` is tautological (the tables were built from the same data);
the check becomes meaningful with official tables or new imports. No missing class is invented.

## 5. Entity resolution (persons)

- Person key = normalized NIK when non-empty, whatever its format; otherwise `ROW:<id_athlete>`.
- Attributes (name, gender, birth date, height, weight, belt) are taken when all rows agree;
  on disagreement the attribute is `null` and `ATHLETE_ATTRIBUTE_CONFLICT` lists every value.
- Contingent is **not** a person attribute (F-06); it belongs to the entry.
- `POSSIBLE_DUPLICATE_PERSON` flags same name + birth date under different keys; persons are
  never merged automatically.

## 6. Entry-group reconstruction

- `INDIVIDUAL` rows → one entry each (`externalRef = id_athlete`).
- `PAIR` rows are grouped by _(classification, division, contingent)_; `TEAM` rows by
  _(classification, division, contingent, gender)_. This key is a heuristic observed in 2026
  (F-03/F-04, `EVIDENCE_2026`), not a rule.
- A group whose rows form **exactly one** valid composition (rule-set `composition`: pair =
  1 F + 1 M, team = 3 of one gender) becomes one entry with an `entry_group` of source
  `HEURISTIC`, status `PROPOSED`, confidence `HIGH`, and evidence (key, member rows, rule).
- More rows than one composition but divisible into several (e.g. 2 F + 2 M) → every row gets
  `ENTRY_GROUP_AMBIGUOUS`; no entry is formed. Not divisible → `ENTRY_GROUP_INCOMPLETE`. These
  rows are listed as unresolved; they are never grouped best-effort.
- A `PROPOSED` group keeps its entry `BLOCKED` (`ENTRY_GROUP_UNCONFIRMED`) until a person
  confirms it (ADR-0010). `EXPLICIT`/`IMPORTED` sources are supported by the adapter interface
  for exports that carry an entry id.
- Entry ids are deterministic: `deterministicUuid('bagantkd/entry', <tournament>|<sorted member row ids>)`.

## 7. Category derivation

Pure function of _(entry, rule set)_:

1. Template = rule-set template for _(stream, discipline, format)_; none → `NO_CATEGORY_TEMPLATE`.
2. For each partition dimension of the template, in order:
   `STREAM`, `DISCIPLINE`, `FORMAT` from the entry; `AGE_DIVISION` = **declared** division (a
   play-up athlete competes in the division entered); `GENDER` = the members' common gender for
   `BY_ENTRY`, `MIXED` for `MIXED` templates; `WEIGHT_CLASS` = declared class, which must exist in
   the table for _(stream, division, gender)_ else `UNKNOWN_CLASS`; `MOVEMENT` = belt → band in the
   template's movement map → movement, else `MOVEMENT_UNRESOLVED`.
3. Category key = `TEMPLATE|DIM=value|…` (canonical string); category id =
   `deterministicUuid('bagantkd/category', rule-set fingerprint | key)`.

Categories are structural: blocked entries still belong to their category and are reported
there; eligibility decides whether the engine may place them. No number of categories exists
anywhere in business logic — 238 appears only in the golden test.

## 8. Eligibility, snapshots, persistence

- `RegistrationStatus` = workflow (`REGISTERED` on import). `EligibilityStatus` = derived by
  `deriveEligibility` from: terminal registration, open blocking issues (severity by usage,
  after overrides), rule gaps, entry-group finality. It is recomputed, never edited.
- **Intake snapshot**: canonical, fingerprinted JSON of every entry as the engine sees it
  (members' effective height/weight/belt/birth year, declared division/class, contingent key,
  eligibility, blocking reasons). Stored in a new immutable table `intake_snapshot`.
- **DrawRun binding** (instruction 5): `draw_run.intake_snapshot_id` (NOT NULL) plus the existing
  rules snapshot, seed and engine version; all immutable by trigger.
- **Import batches**: once `COMMITTED`, the batch and its rows are immutable (trigger);
  `import_row.normalized` is written once. A re-import is a new batch and a new snapshot; old
  snapshots and the draw runs bound to them are untouched. `diffIntake(previous, next)` reports
  added / removed / changed entries; applying changes to live entries is a Phase 4 command.
- NIK is stored as AES-256-GCM ciphertext plus an HMAC-SHA-256 blind index (keys from the
  environment; fixed test keys in tests). Raw import rows keep the original string (ADR-0014).

## 9. Differential test strategy

Three independent computations must agree:

| Oracle                      | What it is                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1 — ACCEPTANCE_CRITERIA §5 | Numbers computed in Phase 0 / Phase 1 analysis, before this plan                                                                                         |
| O2 — Python baseline        | `tools/phase2-baseline/baseline.py`, written from this plan, no shared code; emits aggregate counts (committed) and per-row / per-entry detail (private) |
| O3 — TypeScript pipeline    | `packages/intake`                                                                                                                                        |

- Compared: rows, persons, entries, entry groups (by source/status/confidence), unresolved rows,
  every issue code count, blocked counts, categories (total and per stream), and — using the
  private detail — the exact issue-code set of every row, the member set and category key of
  every entry.
- Any difference fails the golden test and is listed. It is explained in the gate report before
  Phase 2 is considered complete. Expected values in O1 are not edited to make O3 pass; if O1
  itself is shown wrong, the correction is documented with evidence and approved in review.
- Both implementations are written by the same author; independence is at the implementation
  level. The hand-written regression fixture (§9.1) is a third, human-checkable oracle.

### 9.1 Regression fixtures (instruction 11)

`fixtures/intake/dirty-cases.csv` — synthetic people only — with one row per real 2026 defect:
height 734 cm, weight 420 kg, swapped height/weight, zero height and weight, trailing NIK
punctuation, NIK gender mismatch, NIK birth-date mismatch (year and day/month), play-up,
play-down (conflict), `=+53`, bare `53`, `53+`, same person in two entries and two contingents,
conflicting belt across entries, a valid pair, an ambiguous pair set, an incomplete team.
`dirty-cases.expected.json` lists, per row, the exact expected issue codes, severities,
normalized values and suggestions.

### 9.2 Canonical normalization tests (instruction 4)

Unit + property tests per normalizer: gender, belt, weight-class variants (`=+NN`, `+NN`, `NN+`,
`-NN`, `=-NN`, Unicode minus, bare `NN`), decimal height/weight (dot, comma, precision, zero,
garbage), NIK (punctuation, spaces, length), dates (valid, invalid calendar days, other formats),
names (whitespace, case preserved). Property: `raw` is always preserved byte-for-byte; a
normalizer never returns a value without a rule and provenance; normalizing a canonical value is
the identity.

## 10. Exit criteria (the gate)

Phase 2 is complete only when all of these hold, and it stops there for review.

| #   | Criterion                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Golden test: TypeScript reproduces every ACCEPTANCE §5 Phase 2 value exactly (3,154 rows; 3,121 persons; 3,115 entries; 28 groups `HEURISTIC`/`PROPOSED`/`HIGH`, 0 ambiguous; 238 categories = 71 / 105 / 36 / 17 / 9; every listed issue count; 21 blocked semi-prestasi entries)                                 |
| E2  | Differential: O2 = O3 on every aggregate and on every row's issue set and every entry's members and category; zero unexplained differences                                                                                                                                                                         |
| E3  | Regression fixture: every row's expected issues, severities, normalized values and suggestions match exactly                                                                                                                                                                                                       |
| E4  | Normalization unit + property tests pass; no normalizer loses the raw value                                                                                                                                                                                                                                        |
| E5  | DB: committed import batch and rows immutable; normalized written once; transformation resolution recorded once with resolver + reason; `intake_snapshot` immutable; `draw_run` requires a snapshot; a re-import does not change an existing snapshot or the runs bound to it — tested on PGlite and PostgreSQL 16 |
| E6  | Golden persistence: the 2026 intake persists into both backends in one transaction with counts equal to E1                                                                                                                                                                                                         |
| E7  | Engine stages `normalizeEntries`, `validateEntries`, `gateEligibility`, `buildCategories` implemented; the simulator's `toEngineEntries` implemented; the engine still refuses at `buildPools`                                                                                                                     |
| E8  | Reports produced: Data Transformation Report and Differential Report (aggregates committed; row-level detail private)                                                                                                                                                                                              |
| E9  | Determinism: intake of the same bytes + rule set yields the same snapshot fingerprint (property and golden); SYNTHETIC_5K and SYNTHETIC_10K intake without error                                                                                                                                                   |
| E10 | All previous tests still pass; typecheck, lint, `format:check` clean locally **and** in CI                                                                                                                                                                                                                         |

## 11. Assumptions made in this plan

| ID    | Assumption                                                                   | Provenance                                     |
| ----- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| P2-A1 | Person identity = normalized NIK string, even when the NIK format is invalid | ENGINEERING_DEFAULT                            |
| P2-A2 | `NIK_BIRTHDATE_MISMATCH` is a WARNING regardless of division impact          | ENGINEERING_DEFAULT (committee may escalate)   |
| P2-A3 | Pair/team grouping key (§6)                                                  | EVIDENCE_2026                                  |
| P2-A4 | Freestyle belongs to the PRESTASI stream                                     | EVIDENCE_2026 assumption (already in rule set) |
| P2-A5 | Declared division and declared class are authoritative for categories (A-12) | STAKEHOLDER                                    |
| P2-A6 | Issue counts for member-level checks are per row                             | ENGINEERING_DEFAULT (matches Phase 0 counting) |

## 12. Plan corrections found during implementation

| Date       | Section      | Correction                                                                                                                                                                                                                             | Found by                                                                                       | Effect on expected values                                                                                                                    |
| ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-11 | §4 swap rule | Required _both_ height and weight implausible. Missed evident swaps where the misread weight is still under 130 kg (e.g. `TB=23, BB=122`, class `-24`: 23 kg, 122 cm). Now: _either_ implausible and the swapped pair fully plausible. | Differential O1 vs O2: 10 vs 12 swaps, 3 vs 1 height out of range, 253 vs 252 class mismatches | None — O1 values stand; the corrected rule reproduces them (12 / 1 / 1 / 252), and all 12 swaps are confirmed by their declared weight class |
| 2026-09-12 | §7 movement  | Movement of a multi-member entry came from its first member (order-dependent). Now every member must resolve to the same movement, else `MOVEMENT_UNRESOLVED`.                                                                         | Engine stage 4 design review                                                                   | None — no 2026 template has MOVEMENT on a pair/team format; O2 and O3 outputs unchanged                                                      |
| 2026-09-12 | §8 readiness | A category with withheld entries: readiness made a rule-set policy (`categoryReadiness.withheldEntries`, default `BLOCK_CATEGORY`, ENGINEERING_DEFAULT) instead of engine code. Singletons are unaffected (`poolPolicies.singleton`).  | Stakeholder review                                                                             | None on intake values; engine reports 207 READY / 31 BLOCKED categories                                                                      |
| 2026-09-12 | §10 E9       | Synthetic generator (Phase 1) chose weight classes from unrounded weights, assigned classes outside observed-subset tables and could repeat NIKs. Fixed; SYNTHETIC_5K/10K fingerprints re-pinned.                                      | E9 injected-rate test                                                                          | None on REAL_2026                                                                                                                            |
