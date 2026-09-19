# Semi-Prestasi Requirement Audit

Audit only. No code was changed to produce this document. Baseline audited: commit
`1f652d6075b72c96cc49584d6e65c46e4bfbd821`, tag `phase-6-official-exports-v0.1.2`, CI GREEN.

Evidence sources: direct code reading (`packages/rules`, `packages/draw-engine`, `packages/intake`,
`packages/domain`, `packages/db`, `apps/api`, `apps/web`, `packages/export`), the real committee
rule-set fixture `fixtures/rulesets/piala-gubernur-2026.provisional.json`, and live execution of the
unmodified pooling engine (`packages/draw-engine/src/pooling.ts`) against that fixture for n = 1–20
and four synthetic contingent scenarios (scripts run via `tsx`, not committed, not part of the test
suite — pure observation).

## Status setelah remediasi pra-UAT (bagian ini ditambahkan setelah audit)

Legenda pada tabel §12: ✅ = sudah diimplementasikan; ⏸ = sengaja ditunda. Isi audit di bawah
tetap menggambarkan kondisi **sebelum** perbaikan.

| ID      | Status               | Bukti (uji)                                                                                                                                  | Catatan                                                                                                                                                                                                                                                                                              |
| ------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-004 | ✅ diimplementasikan | `packages/draw-engine/src/contingent-spread.test.ts`, properti Tier 3 di `pooling.property.test.ts`, gerbang golden REAL_2026                | Tie-break Tier 3 (penyebaran kontingen), tetap lunak, tanpa perubahan Tier 0. `ENGINE_VERSION` 0.2.0 → 0.3.0; sidik jari golden baru `sha256:9625825c…e5f2` (lama `e9f8d118…45ed`) terekam di `fixtures/datasets/manifest.json`. 10 dari 201 kategori berubah; lihat `docs/PHASE3_CALIBRATION.md` §6 |
| AUD-005 | ✅ diimplementasikan | `impact.test.ts` (draw-engine), `command-quality.db.test.ts`, `apps/api/src/command-refusal.contract.db.test.ts`, `CommandFeedback.test.tsx` | Verdict GREEN/YELLOW/RED kanonik dari mesin; RED menolak tanpa mengubah apa pun; YELLOW butuh alasan operator; tercatat di `draw_command.verdict` dan `audit_event.after`                                                                                                                            |
| AUD-006 | ✅ diimplementasikan | `revision-supersede.db.test.ts`                                                                                                              | PUBLISH revisi pengganti memindahkan induk AMENDED → SUPERSEDED memakai aksi SUPERSEDE yang sudah ada; ada peristiwa audit `LIFECYCLE_SUPERSEDE`                                                                                                                                                     |
| AUD-007 | ✅ diimplementasikan | `command-rejection.db.test.ts`, kontrak API                                                                                                  | `BRACKET_INVARIANT_VIOLATED` → penolakan stabil HTTP 422 tanpa mutasi sebagian; kerusakan tak terduga tetap 500 buram                                                                                                                                                                                |
| AUD-008 | ✅ diimplementasikan | `uat-readiness.contract.db.test.ts`, `apps/web/app/tournaments/page.test.tsx`                                                                | `GET /tournaments` + halaman `/tournaments`                                                                                                                                                                                                                                                          |
| AUD-009 | ✅ diimplementasikan | kontrak API + `peserta/page.test.tsx`                                                                                                        | `GET /tournaments/:id/entries` + halaman `/tournaments/:id/peserta`; tanpa NIK                                                                                                                                                                                                                       |
| AUD-010 | ✅ diimplementasikan | kontrak API + `drawing/page.test.tsx`                                                                                                        | `GET /tournaments/:id/draw-preflight` + halaman `/tournaments/:id/drawing` ("Buat Drawing")                                                                                                                                                                                                          |
| AUD-012 | ✅ diimplementasikan | uji templat, `pdf.render.test.ts`, uji DB ekspor                                                                                             | Tipe `SEMI_PRESTASI_COMPACT_DRAW_SHEET` (PDF), tanpa mengubah semantik drawing                                                                                                                                                                                                                       |
| AUD-001 | ⏸ ditunda            | —                                                                                                                                            | Menunggu konfirmasi panitia; bobot Poomsae **tidak** diaktifkan                                                                                                                                                                                                                                      |
| AUD-002 | ⏸ ditunda            | —                                                                                                                                            | Menunggu definisi aturan Pasangan/Beregu semi-prestasi; template tidak ditambahkan                                                                                                                                                                                                                   |
| AUD-003 | ⏸ ditunda            | —                                                                                                                                            | Ditunda bersama AUD-002; aturan agregasi multi-anggota tidak dibuat                                                                                                                                                                                                                                  |
| AUD-011 | ⏸ ditunda            | —                                                                                                                                            | Tidak diperlukan untuk UAT awal                                                                                                                                                                                                                                                                      |

Alur UAT lengkap (tautan ke `docs/UAT_RUNBOOK.md`) diverifikasi dengan Playwright pada PostgreSQL nyata:
`apps/web/e2e/uat-flow.spec.ts`.

## 1. Executive summary

The engine's pooling mechanism is sound and matches the explicit participant-count and
contingent-softness requirements exactly, verified by direct execution rather than inference. The
category-partitioning mechanism (gender / age division / declared weight class / movement / format)
is correctly hard-enforced for both disciplines. The three real gaps are concrete and narrow:

1. **Poomsae weight tolerance is configured OFF** in the committee rule set, contradicting this
   audit's explicit new requirement that Poomsae grouping consider weight (`AUD-001`,
   `BUSINESS_DECISION`).
2. **No semi-prestasi category templates exist for Poomsae Pair/Team** — only Individual — so those
   entries are permanently blocked before they ever reach pooling (`AUD-002`, `MISSING_REQUIREMENT`),
   compounded by a latent bug in how a multi-athlete entry's physical data would be represented if
   such a template were added (`AUD-003`, `BUG`).
3. **Move/Swap commands never re-check contingent or tolerance quality** after a complaint-driven
   edit (`AUD-005`), and one lifecycle action (`SUPERSEDE`) is defined but never invoked (`AUD-006`).

None of these require draw-engine, persistence, fingerprint, or export-architecture changes. Two are
ruleset/config decisions; the others are small, additive code changes.

**Weighted compliance: 28 / 35 requirement checks (~80%) fully or substantially compliant** (see §2).
UAT verdict: **READY_WITH_LIMITATION** — a guided UAT session can proceed today; three UI gaps
(tournament list, entries list, "generate draw" button) should be patched first for unguided use.

## 2. Requirement compliance matrix

| #       | Requirement                                                                          | Status          | Note                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1–R3   | Kyorugi: gender / age division / declared weight class are hard category boundaries  | PASS            | `packages/rules/src/schema.ts:40-49` `PARTITION_DIMENSIONS`; enforced in `packages/intake/src/categories.ts:30-99`                                                                                                                                   |
| R4–R6   | Kyorugi: weight / height / belt are active soft pool dimensions                      | PASS            | fixture `KYORUGI_SEMI_POOL`: all three `active: true`                                                                                                                                                                                                |
| R7      | Kyorugi: contingent is a soft pool factor                                            | PASS            | `pooling.ts:213-226` (tier2 only)                                                                                                                                                                                                                    |
| R8–R9   | Poomsae: gender / age division hard                                                  | PASS            | same mechanism as R1-R3                                                                                                                                                                                                                              |
| R10     | Poomsae: format (Individual/Pair/Team) hard, all three usable at semi-prestasi       | PARTIAL         | Pair/Team templates exist only for `PRESTASI` stream, not `SEMI_PRESTASI` (`AUD-002`)                                                                                                                                                                |
| R11     | Poomsae: movement hard                                                               | PASS            | `packages/intake/src/categories.ts:79-91`                                                                                                                                                                                                            |
| R12     | Poomsae: belt level considered                                                       | PASS (indirect) | `belt.policy: DISABLED` at pool level, but movement is itself derived from belt band (`usage.ts:12`) — belt is enforced via the movement partition, not a separate pool dimension                                                                    |
| R13     | Poomsae: weight is a soft pool factor                                                | **FAIL**        | fixture: `WEIGHT.active: false`, explicit stakeholder note "disabled by default... configurable" (`AUD-001`)                                                                                                                                         |
| R14     | Poomsae: height soft                                                                 | PASS            | fixture: `HEIGHT.active: true`, ideal 50mm                                                                                                                                                                                                           |
| R15     | Poomsae: contingent soft                                                             | PASS            | same mechanism as R7                                                                                                                                                                                                                                 |
| R16     | Pool split for n = 1,2,3,4                                                           | PASS            | verified by execution (§6)                                                                                                                                                                                                                           |
| R17     | Pool split 5→3+2, 6→3+3, 7→4+3, 8→4+4                                                | PASS            | verified by execution (§6)                                                                                                                                                                                                                           |
| R18     | Larger groups generalize the same small-pool principle                               | PASS            | verified for n = 9–20 (§6)                                                                                                                                                                                                                           |
| R19     | Contingent separation is NOT a hard rule                                             | PASS            | zero tier0 contribution anywhere in `poolCost()`                                                                                                                                                                                                     |
| R20     | "Whenever reasonably possible, each pool gets an outsider" preference                | PARTIAL         | cost function sums tier2 across pools with no per-pool fairness term, so mathematically-tied distributions aren't disambiguated toward this preference (`AUD-004`)                                                                                   |
| R21     | ≈5cm / ≈5kg expressed as soft ideal, not universal hard max                          | PASS            | `tolerance.ideal` (soft, quadratic-penalty-beyond) is separate from `tolerance.max` which defaults to `UNSET` (no cap)                                                                                                                               |
| R22–R25 | Tolerance configurable globally / per discipline / per age division / per tournament | PASS            | separate `KYORUGI_SEMI_POOL`/`POOMSAE_SEMI_POOL` policies (per discipline); `tolerance.ageDivisionCode` nullable override (per age division, mechanism present, currently unpopulated — a data task, not a system gap); one `RuleSet` per tournament |
| R26     | MoveEntry/SwapEntries exist, RBAC- and lifecycle-gated, concurrency-safe             | PASS            | `command-repository.ts:449-457,611-629`                                                                                                                                                                                                              |
| R27     | Move/swap re-validates contingent/tolerance quality                                  | **FAIL**        | verdict hardcoded `GREEN` (`command-repository.ts:575,641`) (`AUD-005`)                                                                                                                                                                              |
| R28     | A new revision (via AMEND) is required before post-publish edits                     | PASS            | `revision-lifecycle.ts:19-40`, `command-repository.ts:531-546`                                                                                                                                                                                       |
| R29     | Every move/swap is audit-logged                                                      | PASS            | `audit-repository.ts:31-81`, called at `command-repository.ts:652-666`                                                                                                                                                                               |
| R30     | Amended revision must pass review again before re-publish                            | PASS            | fresh DRAFT→REVIEW→APPROVED→LOCKED→PUBLISHED required                                                                                                                                                                                                |
| R31     | Superseded parent revision is cleanly retired                                        | **FAIL**        | `SUPERSEDE` defined, never invoked anywhere (`AUD-006`)                                                                                                                                                                                              |
| R32     | Drag-and-drop calls backend commands, not local-only state                           | PASS            | `PoolCard.tsx`/`EntryCard.tsx` native HTML5 DnD → `api.moveEntry`/`api.swapEntry`                                                                                                                                                                    |
| R33     | Pair/Team: data model, intake, engine, persistence, export are format-agnostic       | PASS            | see §5                                                                                                                                                                                                                                               |
| R34     | Pair/Team: usable at semi-prestasi                                                   | **FAIL**        | same as R10 (`AUD-002`)                                                                                                                                                                                                                              |
| R35     | Pair/Team: correct representative physical value for pooling                         | **FAIL**        | `draw.ts:99-108` uses `members[0]` only (`AUD-003`)                                                                                                                                                                                                  |

PASS = 27, PARTIAL = 2, FAIL = 6. Weighted: (27 + 2×0.5) / 35 = **28/35 ≈ 80%**.

## 3. Kyorugi audit

Traced `ruleset → categories.ts (intake) → stages.ts (draw-engine) → pooling.ts → quality.ts`.

| Factor                | Classification                             | Evidence                                                                                                                                     |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| gender                | HARD CONSTRAINT                            | `categoryTemplate.dimensions` includes `GENDER`; `deriveCategory` (`packages/intake/src/categories.ts:45-51`) folds it into the category key |
| age division          | HARD CONSTRAINT                            | `AGE_DIVISION` dimension; `ageDivisions[].minBirthYear/maxBirthYear`                                                                         |
| declared weight class | HARD CONSTRAINT                            | `WEIGHT_CLASS` dimension; validated against `weightClassTables` (`stages.ts:99-108`)                                                         |
| weight                | SOFT OPTIMIZATION                          | `KYORUGI_SEMI_POOL.tolerances[WEIGHT].active=true`, ideal 5000g, linear/quadratic penalty (`pooling.ts:141-162`)                             |
| height                | SOFT OPTIMIZATION                          | `HEIGHT.active=true`, ideal 50mm                                                                                                             |
| belt                  | SOFT OPTIMIZATION                          | `belt.policy: SOFT`, `BELT.active=true`, ideal 2 ranks                                                                                       |
| contingent            | SOFT OPTIMIZATION (tier2, lowest priority) | `pooling.ts:213-226`; only spends the leftover `tier1SlackFp` budget (`localSearch`, phase `'tier2'`)                                        |

All backed by executable code and the real fixture, not comments. No factor is `UNUSED`.

## 4. Poomsae audit

Same trace, `POOMSAE_SEMI_POOL` policy and `POOMSAE_SEMI_MOVEMENT` movement map.

| Factor     | Configured where                                   | Engine consumes it?                                            | Scoring?                      | Hard/Soft                                | Tests?                                                                                     |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| gender     | `GENDER` dimension                                 | yes                                                            | category split                | HARD                                     | `model.test.ts`, `categories.ts` tests                                                     |
| age        | `AGE_DIVISION` dimension                           | yes                                                            | category split                | HARD                                     | same                                                                                       |
| format     | template per format                                | **only for `PRESTASI`; no `SEMI_PRESTASI` Pair/Team template** | category split                | HARD (Individual only, at semi-prestasi) | none possible — never reaches a template                                                   |
| belt       | not a pool dimension (`belt.policy: DISABLED`)     | indirectly, via `MOVEMENT`                                     | category split (via movement) | HARD (indirect)                          | `usage.ts:12` has no dedicated unit test found for this specific belt→movement equivalence |
| height     | `HEIGHT.active=true`                               | yes                                                            | pool cost                     | SOFT                                     | `pooling.property.test.ts` (generic, not Poomsae-specific)                                 |
| weight     | `WEIGHT.active=false`                              | **no**                                                         | none                          | UNUSED (mechanism exists, switched off)  | n/a — inactive                                                                             |
| movement   | `MOVEMENT` dimension + `POOMSAE_SEMI_MOVEMENT` map | yes                                                            | category split                | HARD                                     | `categories.ts`                                                                            |
| contingent | same as Kyorugi                                    | yes                                                            | pool cost, tier2              | SOFT                                     | `pooling.property.test.ts`                                                                 |

**The historical-assumption mismatch (explicitly requested comparison):** the fixture's own
provenance note reads _"Q5: weight disabled by default for poomsae semi prestasi (2026 evidence);
configurable."_ This was a **stakeholder decision recorded against 2026 evidence**, not a code
limitation — the `ideal`/`linearWeightPermille`/`overflowWeightPermille` values are already fully
configured (`ideal: 5000`), only `active` is `false`. This audit's new explicit requirement
("POOMSAE SEMI PRESTASI grouping considers... weight") **directly conflicts with that recorded
stakeholder decision**. Per instruction, **not silently enabled**. Classified `AUD-001`,
`BUSINESS_DECISION`: the committee must explicitly reconfirm or reverse Q5 in light of the new
requirement; if reversed, the fix is a one-line `active: true` in the ruleset JSON, no code change.

## 5. Pair/Team capability

| Layer                 | Status                                                                                               | Evidence                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data model            | full support                                                                                         | `ENTRY_FORMATS` = INDIVIDUAL/PAIR/TEAM (`domain/src/enums.ts:13`); `entry_member`/`entry_group` tables (`db/src/schema/participants.ts:270-321`)                   |
| Intake                | full support, exercised on real 2026 data                                                            | `reconstructEntries` groups by format+stream+discipline+division(+gender for TEAM) (`intake/src/entries.ts:16-41`); golden test expects 28 real entry groups       |
| Category generation   | **breaks here**                                                                                      | `fixtures/rulesets/...json` has `POOMSAE_PRESTASI_PAIR`/`POOMSAE_PRESTASI_TEAM` but no `SEMI_PRESTASI` equivalents                                                 |
| Eligibility           | entries permanently BLOCKED, non-overridable                                                         | `packages/domain/src/participant-status.ts:47`: `ruleGaps > 0` (which `NO_CATEGORY_TEMPLATE` is) forces `BLOCKED` with no override path, unlike issue-based blocks |
| Pooling               | latent bug, currently dormant                                                                        | `draw.ts:99-108`: `toPoolEntry` reads only `e.members[0]`'s weight/height/belt — not an average, not explicit "N/A", a silent single-athlete shortcut              |
| Draw engine / bracket | format-agnostic, no branching needed                                                                 | confirmed no PAIR/TEAM conditionals anywhere in `packages/draw-engine/src`                                                                                         |
| Persistence           | format-agnostic                                                                                      | no format-specific schema in `db/src/schema`                                                                                                                       |
| UI                    | roster renders correctly in the detail drawer; compact card shows only first athlete's physical meta | `EntryDrawer.tsx:36-48` (full roster) vs. `EntryCard.tsx:27,39` (first athlete only, cosmetic)                                                                     |
| Export                | format-agnostic, correct                                                                             | `ExportEntry.athletes` and joined `displayName` render correctly for any member count                                                                              |

**Conclusion:** support stops at the rule-set's category-template layer (`AUD-002`), not in code.
Every layer below it is ready and would work the moment a `SEMI_PRESTASI`+`POOMSAE`+`PAIR`/`TEAM`
template is added — except the pooling shortcut (`AUD-003`), which would then need to be resolved
first (a genuine open question: average? both athletes must independently satisfy tolerance? explicit
exclusion of weight/height for grouped formats?). This second question is a `BUSINESS_DECISION`
nested inside a `BUG` — the current behavior is not a decided rule, it is an accident of
`members[0]`.

## 6. Pool-size verification (executed, not modified)

Ran the real `resolvePolicy`/`buildCandidates`/`rankCandidates` from `packages/draw-engine/src/pooling.ts`
against the real `KYORUGI_SEMI_POOL` and `POOMSAE_SEMI_POOL` policies (`poolTarget=4, poolMax=4` for
both) with synthetic identical-attribute entries, n = 1 through 20:

```
n=1  -> [1]            n=8  -> [4,4]           n=13 -> [4,3,3,3]
n=2  -> [2]            n=9  -> [3,3,3]         n=16 -> [4,4,4,4]
n=3  -> [3]            n=10 -> [3,4,3]         n=20 -> [4,4,4,4,4]
n=4  -> [4]            n=11 -> [3,4,4]
n=5  -> [3,2]          n=12 -> [4,4,4]
n=6  -> [3,3]
n=7  -> [4,3]
```

Exact match to the required n=1→singleton, n=2→one match, n=3→semifinal+final-wait, n=4→two
semis+final, and n=5→3+2, n=6→3+3, n=7→4+3, n=8→4+4. Larger groups (9–20) consistently split into
pools of 3–4, never producing an oversized or degenerate pool. **Classification: `NO_CHANGE_NEEDED`.**
(POOMSAE_SEMI_POOL gave the same sizes, since size penalty is driven by `poolMax`/`sizePenaltyFp`,
which are identical between the two policies in this fixture — only the tolerance dimensions differ,
confirmed in §4.)

## 7. Contingent behavior (executed, not modified)

Same live execution, four synthetic scenarios, `KYORUGI_SEMI_POOL`:

- **Dominant contingent (A=6, B=1, C=1, n=8):** result `[A,A,B,C]` + `[A,A,A,A]`, tier2 cost 40000.
  The example the audit asked to check for — `[A,A,A,B]` + `[A,A,A,C]` — was computed by hand to have
  the **identical total tier2 cost** (40000): the cost function sums `contingentExcess` and
  `minSameRound1` across pools independently, with no per-pool fairness term, so these two layouts are
  cost-ties and the algorithm's deterministic first-improvement scan picked the one shown, not
  necessarily the "give every pool an outsider" one. **`AUD-004`, `MISSING_REQUIREMENT`, minor** — both
  outcomes are valid and soft (neither is wrong), but the specific "outsider-per-pool" preference isn't
  encoded as a tie-break.
- **Perfectly diverse (8 distinct contingents):** `[A,D,F,G]` + `[B,C,E,H]`, cost 0 — ideal.
- **Two-contingent (A=4, B=4):** `[A,A,B,B]` + `[A,A,B,B]`, cost 0 — perfectly balanced.
- **One-contingent-only (A=8):** `[A,A,A,A]` + `[A,A,A,A]`, cost 40000×2 — correctly still produces
  two valid, non-singleton pools; never blocks the draw. Matches the requirement that dominance is
  allowed, not forbidden.

Contingent separation contributes **zero** to `tier0` (the only hard/blocking cost tier) in every
scenario — **confirmed SOFT**, exactly as required, with the one nuance in `AUD-004`.

## 8. Tolerance configuration

| Concept                 | Representation                                                                                      | Evidence               |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| preferred tolerance     | `tolerance.ideal` (soft center)                                                                     | `schema.ts:124-137`    |
| soft penalty            | `linearWeightPermille` (inside ideal) + `overflowWeightPermille` (quadratic, beyond ideal)          | `pooling.ts:141-162`   |
| hard maximum            | `tolerance.max`: `UNSET` / `NONE` / `SET(value)` — a genuinely separate, optional field             | `schema.ts:115-121`    |
| lockability requirement | `MAX_TOLERANCE_UNSET` is a `LOCK_BLOCKER` when a tolerance is active and its `max` is still `UNSET` | `readiness.ts:292-303` |

5cm (`HEIGHT.ideal=50`) and 5kg (`WEIGHT.ideal=5000`) are already **soft ideals**, not hard maxima —
both disciplines' policies leave `max.status: UNSET`, meaning **no universal hard cap is silently
applied**; the system instead requires a committee decision before LOCK. This is an exact match to the
explicit instruction not to treat 5cm/5kg as a universal hard maximum.

Configurability: **globally** (default tolerance row, `ageDivisionCode: null`) — yes. **Per
discipline** — yes, `KYORUGI_SEMI_POOL` and `POOMSAE_SEMI_POOL` are independent policies. **Per age
division** — the schema already supports it (`tolerance.ageDivisionCode` nullable override,
`resolvePolicy` in `pooling.ts:56-59` looks up the specific division first, falling back to the
default), but the current fixture has **zero** populated per-division overrides — this is an
unpopulated data/config task for the committee, not a schema gap. **Per competition/ruleset** — yes,
one `RuleSet` document per tournament. **Classification: `NO_CHANGE_NEEDED`** for the mechanism;
populating actual per-age-division values (if wanted) is a future `BUSINESS_DECISION`, not audited as
a defect here since none was requested.

## 9. Complaint/revision workflow

| Step                                  | Status                                   | Evidence                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MoveEntry/SwapEntries commands        | EXISTS, wired end-to-end (UI → API → DB) | `commands.ts:20-26`, `command-repository.ts:224-266`, `revision.controller.ts:46-76`                                                                             |
| Backend validation                    | PARTIAL                                  | RBAC, lifecycle-state, optimistic concurrency (`lock_version`), category-boundary all enforced; contingent/tolerance quality is **not** re-checked (`AUD-005`)   |
| New revision on edit                  | EXISTS                                   | edits only accepted in `DRAFT`; a post-publish complaint must go through `AMEND` first, which forks a new child `DRAFT` row (`command-repository.ts:531-546`)    |
| Audit event                           | EXISTS                                   | tamper-evident, hash-chained `audit_event`, written for every command and lifecycle action                                                                       |
| Re-review/approval required           | EXISTS                                   | amended child must pass `SUBMIT→REVIEW→APPROVE→LOCK→PUBLISH` again; `AMENDED` has no direct edge back to `PUBLISHED`                                             |
| Drag-and-drop → real domain command   | CONFIRMED                                | native HTML5 DnD (no library) in `PoolCard.tsx`/`EntryCard.tsx`, calling `api.moveEntry`/`api.swapEntry` → real HTTP command endpoints, not local-state mutation |
| Stale-parent retirement (`SUPERSEDE`) | **MISSING WIRING**                       | domain type and RBAC exist; no controller route or automatic trigger calls it (`AUD-006`)                                                                        |
| Bracket-invariant violation handling  | **ROUGH EDGE**                           | throws a raw `DomainError` instead of a mapped rejection (`AUD-007`)                                                                                             |

Most significant gap: a move/swap can silently degrade contingent fairness or tolerance quality with
no warning (`verdict` hardcoded `GREEN`) — the operator gets no signal, only a clean audit record of an
action that may have made the draw worse.

## 10. Semi-prestasi export assessment

Current Phase 6 exports (`CATEGORY_DRAW`, `POOL_SHEET`, `BRACKET_SHEET`, `TOURNAMENT_DRAW_BOOK`, XLSX)
are generic across streams. All data a denser semi-prestasi sheet would need is already present and
persisted in `ExportModel` (`packages/export/src/model.ts`): participant display name, belt (via
athlete data joined at export-source level), height/weight, contingent, category display name, pool,
bracket/matches with match codes, and warnings (`ExportPool.warnings`, `ExportQuality`). No new data
plumbing, fingerprinting, or persistence work is needed — a `SEMI_PRESTASI_COMPACT_DRAW_SHEET` would be
a new PDF template (denser layout, inline participant physical stats) consuming the existing model.
**Classification: `EXPORT_POLISH`** — functional data is fully available; this is a presentation-only
gap, not implemented per instruction.

## 11. UAT readiness

Assume an operator is already authenticated with sufficient role (auth excluded per instructions).

| #   | Action                   | Verdict               | Note                                                                              |
| --- | ------------------------ | --------------------- | --------------------------------------------------------------------------------- |
| 1   | open tournament          | READY_WITH_LIMITATION | detail page works by ID; no tournament list page or list endpoint exists          |
| 2   | inspect imported entries | **BLOCKED**           | no entries/participants list view anywhere; only visible via pool cards or search |
| 3   | inspect category         | READY                 |                                                                                   |
| 4   | generate/view draw       | READY_WITH_LIMITATION | viewing works; no UI button calls the existing `POST /tournaments/:id/draw-runs`  |
| 5   | inspect pool             | READY_WITH_LIMITATION | embedded in the category page, no standalone pool route                           |
| 6   | inspect bracket          | READY                 | real in-UI bracket view, not just PDF                                             |
| 7   | search participant       | READY                 |                                                                                   |
| 8   | search contingent        | READY_WITH_LIMITATION | same shared search box as participant search, no dedicated contingent filter      |
| 9   | move participant         | READY                 | drag-and-drop + dialog, both call backend                                         |
| 10  | swap participant         | READY                 |                                                                                   |
| 11  | handle revision conflict | READY                 | conflict banner + reload                                                          |
| 12  | submit review            | READY                 |                                                                                   |
| 13  | approve                  | READY                 |                                                                                   |
| 14  | lock                     | READY                 |                                                                                   |
| 15  | publish                  | READY                 |                                                                                   |
| 16  | amend                    | READY                 | reason required                                                                   |
| 17  | inspect audit history    | READY                 | paginated                                                                         |
| 18  | generate preview PDF     | READY                 |                                                                                   |
| 19  | generate official PDF    | READY                 |                                                                                   |
| 20  | export XLSX              | READY_WITH_LIMITATION | only reachable from the tournament-level panel, not per-category/pool             |

**Overall UAT verdict: READY_WITH_LIMITATION.** The full review → move/swap → amend → re-review →
publish → export loop works end-to-end today. A guided UAT (facilitator supplies tournament ID, points
testers at a specific category) can run now. For unguided/self-serve UAT, add: a tournament list, an
entries list, and a "generate draw" button — all thin UI additions over existing backend endpoints.

## 12. Findings requiring action

| ID         | Classification      | Severity                                  | Module                                                                         | Expected                                                                         | Current                                                                                 | Smallest fix                                                                                                                 |
| ---------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AUD-001 ⏸  | BUSINESS_DECISION   | High                                      | `fixtures/rulesets/*.json` (POOMSAE_SEMI_POOL)                                 | Poomsae semi-prestasi pooling considers weight                                   | `WEIGHT.active=false` (stakeholder Q5, 2026 evidence)                                   | Committee reconfirms/reverses Q5; if reversed, flip `active:true` — no code change                                           |
| AUD-002 ⏸  | MISSING_REQUIREMENT | High                                      | `fixtures/rulesets/*.json` categoryTemplates; `intake/categories.ts`           | Poomsae Pair/Team usable at semi-prestasi                                        | No `SEMI_PRESTASI`+`POOMSAE`+`PAIR`/`TEAM` template exists; entries permanently BLOCKED | Add the two category templates (+ composition rules); depends on AUD-003 being resolved first if pooling is desired for them |
| AUD-003 ⏸  | BUG                 | Medium (dormant; High once AUD-002 lands) | `packages/draw-engine/src/draw.ts:99-108`                                      | A defined, deliberate rule for a multi-athlete entry's pooled weight/height/belt | Silently uses `members[0]` only                                                         | Make the representative-value rule explicit and committee-decided before any pooled Pair/Team template is enabled            |
| AUD-004 ✅ | MISSING_REQUIREMENT | Low                                       | `packages/draw-engine/src/pooling.ts` (`poolCost` tier2)                       | Ties are broken toward "every pool gets an outsider"                             | Tier2 cost sums independently per pool; ties are unresolved in either direction         | Add a minor tie-break term (e.g. minimize max single-pool contingent share) after the existing tier2 comparison              |
| AUD-005 ✅ | MISSING_REQUIREMENT | Medium-High                               | `apps/api` / `packages/db/src/command-repository.ts` (MOVE_ENTRY/SWAP_ENTRIES) | A post-move/swap soft-quality check (contingent/tolerance), non-blocking         | `verdict` hardcoded `GREEN` always                                                      | Reuse `poolCost()` on the affected pool(s) after the mutation; surface `YELLOW`/warning, don't block                         |
| AUD-006 ✅ | BUG                 | Medium                                    | `packages/domain/src/revision-lifecycle.ts` / `apps/api` PUBLISH handler       | Stale AMENDED parent revisions are retired                                       | `SUPERSEDE` defined + RBAC-gated, never invoked                                         | Call `SUPERSEDE` on the parent when its child's `PUBLISH` succeeds                                                           |
| AUD-007 ✅ | BUG                 | Low-Medium                                | `packages/db/src/command-repository.ts:130-136`                                | A graceful rejection when a move/swap would violate a bracket invariant          | Raw `DomainError` thrown, uncaught by the `ContentRejected` mapping                     | Catch and map to the existing rejection path                                                                                 |
| AUD-008 ✅ | MISSING_REQUIREMENT | Medium                                    | `apps/web`, `apps/api/src/tournament`                                          | Operators can browse tournaments without knowing an ID                           | No list route/endpoint exists                                                           | Add `GET /tournaments` + a simple list page                                                                                  |
| AUD-009 ✅ | MISSING_REQUIREMENT | Low-Medium                                | `apps/web`                                                                     | Operators can inspect all imported entries directly                              | No entries list view exists                                                             | Add a read-only entries table per tournament/category                                                                        |
| AUD-010 ✅ | MISSING_REQUIREMENT | Medium                                    | `apps/web/lib/api.ts`                                                          | A UI action to trigger a new draw run                                            | Backend endpoint exists; no client call or button                                       | Add the `api.ts` call + a button on the category/tournament page                                                             |
| AUD-011 ⏸  | EXPORT_POLISH       | Low                                       | `apps/web` `ExportPanel`                                                       | XLSX reachable from category/pool pages too                                      | Only reachable from the tournament-level panel                                          | Pass `XLSX_WORKBOOK` into `availableTypes` on those pages                                                                    |
| AUD-012 ✅ | EXPORT_POLISH       | Low                                       | `packages/export`                                                              | A denser `SEMI_PRESTASI_COMPACT_DRAW_SHEET` document type                        | Only generic templates exist today                                                      | New PDF template over the existing `ExportModel`; no data-layer change                                                       |

No findings were raised for: live scoring, scheduling, public results, cloud deployment, new
microservices, design-system changes, unrelated refactors, or performance — none were investigated,
per instruction.
