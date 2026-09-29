# UX Redesign Audit — BaganTKD Operator Application

|              |                                                                              |
| ------------ | ---------------------------------------------------------------------------- |
| Status       | Draft for review — audit + specification only, nothing implemented          |
| Scope        | `apps/web` (operator UI) and the `apps/api` surface it calls                |
| Out of scope | Draw engine, business rules, PDF/export rendering, DB schema, authentication |
| Method       | Direct source inspection (file:line citations throughout); no assumptions   |

This document does not propose changing the draw engine, business rules, PDF rendering, database
schema, or authentication. It audits the current operator-facing web application and specifies how
it should look and behave so a tournament operator — not a developer — can run a tournament without
reading source code.

---

## 1. Executive summary

The backend/domain layer (draw engine, revision lifecycle, commands, exports, audit) is mature and
already enforces every safety invariant server-side. The web application that sits on top of it is
functionally real — drag-and-drop move/swap, lifecycle transitions, exports, and audit history all
call genuine, server-authoritative endpoints, not mocks — but it presents itself as an internal
development tool, not a tournament operations system:

- **There is no way to sign in or create a tournament.** The app's front door (`/`) asks the
  operator to paste two raw UUIDs from memory. There is no `POST /tournaments` endpoint at all.
- **There is no way to get participant data into the system from a browser.** CSV import exists
  only as a CLI argument to a developer tool (`tools/draw-simulator/src/cli.ts`); this is the
  single biggest functional gap standing between "the engine works" and "an operator can run a
  tournament."
- **Where translation work has been done, it is done well** (`apps/web/lib/impact-labels.ts`,
  `audit-detail.ts`, the Peserta page's eligibility/issue labels) — this sets the pattern the rest
  of the app should follow, not something to redesign from scratch.
- **Where it hasn't**, raw enum values leak straight into the UI: lifecycle steps
  (`DRAFT`/`REVIEW`/`APPROVED`/...), role names (`Requires TECHNICAL_DELEGATE+`), quality labels
  (`OK`/`Warning`/`Blocked`), category readiness (`READY`/`BLOCKED`), and English button labels
  ("Submit for review", "Approve", "Amend") sit next to already-translated Indonesian text on the
  same screens.
- **Nothing is fictional in what follows.** Section 6 classifies every capability as
  IMPLEMENTED / BACKEND_READY / SCRIPT_ONLY / MISSING with citations, so implementation work can be
  scoped accurately instead of guessed.

The redesign's job is therefore less "invent a new product" and more "finish translating what
exists, build the two or three screens that don't exist yet (tournament creation, participant
import), and give the whole thing one consistent operator-grade visual language."

---

## 2. Current route inventory

Confirmed: Next.js **App Router** (`apps/web/app/**`). No `pages/` directory exists. No routes live
under `apps/web/src`.

| # | Route | File |
|---|---|---|
| 1 | `/` | `apps/web/app/page.tsx` |
| 2 | `/tournaments` | `apps/web/app/tournaments/page.tsx` |
| 3 | `/tournaments/[id]` (layout) | `apps/web/app/tournaments/[id]/layout.tsx` |
| 4 | `/tournaments/[id]` | `apps/web/app/tournaments/[id]/page.tsx` |
| 5 | `/tournaments/[id]/peserta` | `apps/web/app/tournaments/[id]/peserta/page.tsx` |
| 6 | `/tournaments/[id]/categories` | `apps/web/app/tournaments/[id]/categories/page.tsx` |
| 7 | `/tournaments/[id]/categories/[categoryId]` | `apps/web/app/tournaments/[id]/categories/[categoryId]/page.tsx` |
| 8 | `/tournaments/[id]/drawing` | `apps/web/app/tournaments/[id]/drawing/page.tsx` |
| 9 | `/tournaments/[id]/draws/[drawRunId]` | `apps/web/app/tournaments/[id]/draws/[drawRunId]/page.tsx` |
| 10 | `/tournaments/[id]/audit` | `apps/web/app/tournaments/[id]/audit/page.tsx` |

**7 routes audited** (excluding the shared layouts at #3). No route exists for tournament creation
or participant import — see §6.

### Per-route detail

#### 1. `/` — entry point
- **Purpose today:** paste a Tournament ID and a User ID to "connect."
- **What the operator sees:** a banner "DEV AUTH ONLY — not a production login system"
  (`apps/web/app/layout.tsx:12`, shown on every page in the app), two plain text inputs with UUID
  placeholders (`page.tsx:40-59`).
- **Primary action:** Connect.
- **Secondary actions:** none.
- **Technical/internal terms exposed:** "actor ID", raw UUID format placeholders.
- **English exposed:** the entire page.
- **Confusing:** an operator has no way to know what these two IDs even are or where to get them.
- **Redundant:** n/a.
- **Missing nav:** n/a (it's the root).
- **Missing empty/loading/error state:** no loading state on connect; no error state for a
  malformed/unknown ID beyond whatever the browser does.
- **Accessibility:** plain labeled inputs, acceptable; no announced error region.
- **Verdict: REDESIGN** (replace entirely — see §4/§10).
- **Proposed role:** replaced by a real tournament list as the true landing page once a dev-session
  abstraction (§4) removes the need to paste IDs.

#### 2. `/tournaments`
- **Purpose:** list tournaments the current actor belongs to.
- **Sees:** a list (`tournaments/page.tsx:17-19`), each row linking to `/tournaments/{id}`.
- **Primary action:** "Buka" (open) per row.
- **Secondary actions:** none — no create, no search, no sort today.
- **Internal terms:** tournament `id` in the `href` (not printed as text — acceptable).
- **Confusing/redundant:** nothing shown besides the essentials, which is good, but there's no way
  to create a tournament from here, no empty state describes what to do next.
- **Missing:** create button, search/sort, empty state copy, loading skeleton.
- **Verdict: REDESIGN** (keep the list-not-cards instinct; add create + states — see §5).

#### 3–4. `/tournaments/[id]` (layout + overview)
- **Purpose:** tournament home; tabs for Overview/Categories/Audit; a `PersonaSwitcher`.
- **Sees:** draw run status, revision status, category counts, warnings
  (`tournaments/[id]/page.tsx:13-19`), raw `run.status`, `rev.lifecycle`, `run.kind` printed directly
  with English labels "Draw run status" / "Revision status" (`page.tsx:42-47,89`).
- **Primary action:** "Buat Drawing" link.
- **Secondary:** "Lihat peserta", "Semua turnamen", embedded `ExportPanel`.
- **Internal terms exposed:** raw lifecycle string, raw draw-run status string, raw `run.kind`
  (`CANDIDATE`/`SIMULATION`).
- **English exposed:** "Draw run status", "Revision status", "None" fallback text.
- **Confusing:** the page mixes a raw status dump with an actionable "what to do" flow; it's not
  clear at a glance whether the operator's data is ready or what's blocking progress.
- **Missing nav:** no route to Peserta from the tab bar shown here (only a link inside the page
  body) — Peserta isn't one of the three tabs (Overview/Categories/Audit) despite being a route.
- **Missing states:** no explicit "drawing not started yet" empty state distinct from a generic
  dash.
- **Verdict: REDESIGN** → becomes **Ringkasan** (§8).

#### 5. `/tournaments/[id]/peserta`
- **Purpose:** read-only participant inspection (explicitly documented as such,
  `peserta/page.tsx:146`).
- **Sees:** paginated table — Peserta, Kontingen, Disiplin, Kategori, Status pendaftaran, Kelayakan,
  Masalah data (`peserta/page.tsx:267-277`); search/filter form (q, contingent, discipline,
  category, eligibility, hasIssues).
- **Primary action:** Terapkan (apply filters).
- **Secondary:** Atur ulang (reset), Sebelumnya/Berikutnya (pagination).
- **Internal terms exposed:** none as visible text — `entryId` is a React key only
  (`peserta/page.tsx:281`); no NIK (confirmed absent server-side too,
  `entry-inspection.controller.ts:107-113`).
- **English exposed:** none found — this page is already fully Indonesian, using dedicated label
  helpers (`eligibilityLabel`, `issueStatusLabel`, `groupStatusLabel`, `confidenceLabel`,
  `groupSourceLabel`). **This is the model the rest of the app should copy.**
- **Confusing/redundant:** none significant.
- **Missing:** an import entry point (there is nowhere on this page — or anywhere — to import data;
  see §6, §9).
- **Verdict: KEEP the translation approach, REDESIGN the surrounding chrome** (add an "Impor Data
  Peserta" action once import UI exists; visual polish to match the rest of the app).

#### 6–7. `/tournaments/[id]/categories` and `/categories/[categoryId]`
- **Purpose:** browse categories; inspect/operate one category's pools and brackets.
- **Sees (list):** table — Category (raw `category_key`), Discipline, Gender, Format, Entries,
  Pools, Readiness, Quality (`categories/page.tsx:90-100,115,117`); `LifecycleBar`.
- **Sees (detail):** pools (`PoolCard`), brackets (`BracketView`, read-only), `ExportPanel`.
- **Primary action (list):** click a row to open detail.
- **Primary action (detail):** drag entry between pools; "Move…" / "Swap…" dialogs; "Move pool…"
  inline form.
- **Internal terms exposed:** `<th>Readiness</th>`/`<th>Quality</th>` (English headers), raw
  `{c.readiness}` value printed directly (`categories/page.tsx:115`) — almost certainly
  `READY`/`BLOCKED` unstranslated; `StatusBadge` prints `OK`/`Warning`/`Blocked` in **English**
  (`StatusBadge.tsx:8`) for a quality concept the domain calls GREEN/YELLOW/RED.
- **English exposed:** table headers "Discipline", "Gender", "Format", "Entries", "Pools",
  "Readiness", "Quality"; `StatusBadge` labels.
- **Confusing:** the category detail page combines browsing, editing, and exporting in one dense
  screen with no clear visual hierarchy between "read this" and "act on this."
- **Missing:** category-type filters described in the product goal (Kyorugi/Poomsae,
  Prestasi/Semi-Prestasi, age division, gender, readiness) beyond whatever `CategoryFilters`
  currently offers — needs a direct read to confirm exact filter set before finalizing (flagged as
  an open item, §29).
- **Verdict: REDESIGN** (list → **Kategori**; detail → folded into the **Drawing Workspace**, §14).

#### 8. `/tournaments/[id]/drawing`
- **Purpose:** preflight + "Buat Drawing" action (explicitly `AUD-010`, `drawing/page.tsx:229`).
- **Sees:** eligible/blocked counts, rule-set/lock status, blockers; a "Jenis drawing" select
  (Kandidat/Simulasi — English `CANDIDATE`/`SIMULATION` internally); a raw numeric "Seed" text
  input.
- **Primary action:** "Buat Drawing" → confirm dialog → poll for completion.
- **Internal terms exposed:** "Seed" is presented directly as an operator-facing numeric field —
  this is a determinism/reproducibility concept from the engine contract, not something a
  tournament operator conceptually owns. Rule-set id / intake-snapshot id are sent in the request
  body but not shown as text (`drawing/page.tsx:262-268`) — correct, keep as-is.
- **English exposed:** none major beyond internal `kind` values leaking into the select's option
  values (need direct confirmation whether the **displayed** option text is already Indonesian —
  flagged in §29).
- **Confusing:** "Seed" with no explanation of why an operator would ever want to type a specific
  number, or what leaving it blank does.
- **Verdict: REDESIGN** — becomes the **Drawing Preflight** screen (§15); Seed moves behind an
  "opsi lanjutan" (advanced options) disclosure, not a primary field.

#### 9. `/tournaments/[id]/draws/[drawRunId]`
- **Purpose:** show one draw run's status and quality.
- **Sees:** `run` + `quality`; raw SHA-256 fingerprints printed as text
  (`draws/[drawRunId]/page.tsx:69-77`).
- **Primary action:** "Browse categories" link, shown only when SAFE.
- **Internal terms exposed:** `rules_fingerprint`, `input_fingerprint`, `output_fingerprint` as raw
  hash strings — pure engine/determinism internals with zero operational value to a tournament
  staff member.
- **Confusing:** a whole page whose only real payload (once SAFE) is "click here to continue" — the
  fingerprints dominate the screen visually despite being the least useful thing on it.
- **Verdict: MERGE** into the Drawing Preflight/Workspace flow as a transient "drawing sedang
  dibuat…" step, not a standalone destination. Fingerprints move behind a "Lihat Detail Teknis"
  disclosure (§16) for anyone who genuinely needs them (e.g. support escalation), never in the
  primary flow.

#### 10. `/tournaments/[id]/audit`
- **Purpose:** append-only history of every mutation.
- **Sees:** When, Action, Subject, Reason, Detail, Hash; cursor pagination ("Load older events").
- **Primary action:** Load older events.
- **Internal terms exposed:** `subject_id` truncated to 8 chars, `hash` truncated to 18 chars — a
  deliberate, reasonable compromise (full values aren't meaningful to an operator, but a truncated
  hash still reads as "computer stuff"); `Action` column likely prints the raw action constant
  (e.g. `MOVE_ENTRY`) — needs direct confirmation (§29) but `auditDetail()` already translates the
  **detail** column for `LIFECYCLE_SUPERSEDE`/verdicts, suggesting the **Action** column itself may
  still be raw.
- **English exposed:** "Load older events" button.
- **Verdict: REDESIGN** → **Riwayat** (§22): translate the Action column using the same pattern as
  `auditDetail()`, translate the button, keep truncated hash behind a "Detail" expansion.

---

## 3. Current UX problems (see §"biggest 10" in the final report for the ranked list)

Cross-cutting issues, not repeated per-route above:

1. No tournament creation surface exists anywhere (UI or API) — an operator cannot start a
   tournament without someone manually inserting a database row.
2. No participant import surface exists in the browser — the single most-used real-world workflow
   (get a CSV of registrations into the system) is CLI-only.
3. The "front door" requires pasting two raw UUIDs, sourced from "a seed script or another
   operator" (`dev-auth.tsx:8-15`) — there is no discoverable way for a first-time user to get in.
4. Lifecycle state is shown as raw enum text in at least two places (`LifecycleBar.tsx:60-62`,
   `tournaments/[id]/page.tsx:46`) while the export type list right next to it
   (`ExportPanel.tsx:17-24`) is fully translated — the app is inconsistent, not uniformly untranslated.
5. Two hardcoded **English** sentences exist inside an otherwise-Indonesian error-translation
   function (`friendlyMessage`, `command-error.ts:44-47`): "You do not have permission to do this."
   and "This revision is no longer editable (locked, published, or amended)."
6. Role names leak directly into UI copy: `Requires {next.minRole}+` renders literally as "Requires
   TECHNICAL_DELEGATE+" (`LifecycleBar.tsx:101`).
7. Quality verdicts are labeled in English (`OK`/`Warning`/`Blocked`, `StatusBadge.tsx:8`) even
   though the exact same concept is already correctly translated elsewhere in the app
   (`impact-labels.ts`'s `IMPACT_CHANGE_LABEL`).
8. Draw-run fingerprints are given a whole page and dominate its visual hierarchy
   (`draws/[drawRunId]/page.tsx:69-77`) despite having no operational meaning to a tournament
   operator.
9. Peserta is not reachable from the tournament's main tab bar (only Overview/Categories/Audit are
   tabs; Peserta is a body link on Overview) — inconsistent navigation.
10. No screen in the app currently explains "what should I do next" as a first-class concept; the
    closest is the Overview page's raw status dump, which requires the operator to already
    understand lifecycle semantics to interpret.

---

## 4. Developer terminology exposure audit

Concrete, cited instances of internal/English terms in operator-facing UI:

| Term as shown | Where | File:line |
|---|---|---|
| Raw UUID input fields | Tournament ID / User ID | `apps/web/app/page.tsx:40-59` |
| "DEV AUTH ONLY — not a production login system" | every page | `apps/web/app/layout.tsx:12` |
| `DRAFT` `REVIEW` `APPROVED` `LOCKED` `PUBLISHED` `AMENDED` (raw) | lifecycle bar | `apps/web/components/LifecycleBar.tsx:60-62` |
| Raw `rev.lifecycle`, raw `run.status`, raw `run.kind` | tournament overview | `apps/web/app/tournaments/[id]/page.tsx:42-47,89` |
| "Requires TECHNICAL_DELEGATE+" (raw role) | lifecycle bar | `apps/web/components/LifecycleBar.tsx:101` |
| "Submit for review" / "Approve" / "Lock" / "Publish" / "Amend" / "Dismiss" (English buttons) | lifecycle bar | `apps/web/lib/lifecycle.ts:21-25`, `LifecycleBar.tsx:69,89,97` |
| "Amended — a child revision is in DRAFT." / "No further action from this state." (English, + raw DRAFT) | lifecycle bar | `LifecycleBar.tsx:107-108` |
| `OK` / `Warning` / `Blocked` (English quality labels) | category list, quality badges | `apps/web/components/StatusBadge.tsx:8` |
| Raw `{c.readiness}` value | category list | `apps/web/app/tournaments/[id]/categories/page.tsx:115` |
| "Readiness" / "Quality" / "Discipline" / "Gender" / "Format" / "Entries" / "Pools" (English headers) | category list | `categories/page.tsx:90-100` |
| "You do not have permission to do this." / "This revision is no longer editable (locked, published, or amended)." (English sentences) | command error mapping | `apps/web/lib/command-error.ts:44-47` |
| `rules_fingerprint` / `input_fingerprint` / `output_fingerprint` raw SHA-256 | draw run page | `apps/web/app/tournaments/[id]/draws/[drawRunId]/page.tsx:69-77` |
| "Load older events" (English button) | audit page | `apps/web/app/tournaments/[id]/audit/page.tsx` |
| "Draw run status" / "Revision status" / "None" (English labels) | tournament overview | `tournaments/[id]/page.tsx:42-47` |
| "Reason for amendment" placeholder, "Amendment reason" aria-label (English) | lifecycle bar | `LifecycleBar.tsx:78-79` |

Already correctly translated (do not redo — replicate the pattern instead):

- `apps/web/lib/impact-labels.ts` — move/swap impact reason codes → Indonesian.
- `apps/web/lib/audit-detail.ts` — audit event detail → Indonesian.
- `apps/web/app/tournaments/[id]/peserta/page.tsx` and its label helpers (`eligibilityLabel`,
  `issueStatusLabel`, `groupStatusLabel`, `confidenceLabel`).
- `apps/web/components/ExportPanel.tsx:17-24` — export type names.
- `apps/web/lib/command-error.ts`'s `friendlyCommandRefusal()` and `friendlyExportMessage()` (all
  branches except the two noted above).

---

## 5. Indonesian terminology dictionary

This is the proposed basis for a centralized `apps/web/lib/terms.ts` (or similar) presentation
layer. **Internal enum/DB values are never renamed — this is a display mapping only.**

### Lifecycle status (`packages/domain/src/revision-lifecycle.ts:19-40`)

| Internal | Operator label | Help text |
|---|---|---|
| `DRAFT` | Draf | Masih dapat diubah bebas. |
| `REVIEW` | Dalam Peninjauan | Menunggu persetujuan; perubahan pool masih dapat dilakukan sampai disetujui. |
| `APPROVED` | Disetujui | Disetujui, siap dikunci. |
| `LOCKED` | Dikunci | Susunan tidak dapat diubah lagi tanpa membuat revisi baru. |
| `PUBLISHED` | Diterbitkan | Menjadi acuan dokumen resmi pertandingan. |
| `AMENDED` | Sedang Direvisi | Ada revisi baru sedang dikerjakan berdasarkan drawing ini. |
| `SUPERSEDED` | Digantikan Revisi Baru | Tidak lagi berlaku; lihat revisi penggantinya. |

### Lifecycle actions (`packages/domain/src/revision-lifecycle.ts:19-29`; only 5 of 9 are wired to any API route — see §6)

| Internal | Operator label |
|---|---|
| `SUBMIT` | Ajukan untuk Ditinjau |
| `APPROVE` | Setujui |
| `LOCK` | Kunci Drawing |
| `PUBLISH` | Terbitkan |
| `AMEND` | Buat Revisi |
| `REJECT` *(not exposed via API — §6)* | Tolak, Kembalikan ke Draf |
| `REOPEN` *(not exposed via API — §6)* | Buka Kembali |
| `ABANDON_AMENDMENT` *(not exposed via API — §6)* | Batalkan Revisi |
| `SUPERSEDE` *(not exposed via API — §6, applied automatically by the system, not an operator action)* | (system-applied; presented as "Digantikan oleh Revisi N", never an operator button) |

### Draw / command quality verdict (`GREEN`/`YELLOW`/`RED`, e.g. `apps/web/lib/api.ts` `CommandVerdict`)

| Internal | Operator label | Help text |
|---|---|---|
| `GREEN` | Aman | Perpindahan tidak menimbulkan masalah baru. |
| `YELLOW` | Perlu Perhatian | Perubahan ini menurunkan kualitas pengelompokan — alasan wajib diisi untuk melanjutkan. |
| `RED` | Tidak Dapat Diterapkan | Perubahan melanggar ketentuan wajib kategori dan tidak dapat dilakukan. |

### Category readiness

| Internal | Operator label |
|---|---|
| `READY` | Siap |
| `BLOCKED` | Diblokir |

### Impact/reason codes (already translated — `apps/web/lib/impact-labels.ts:7-20`; reproduced here for a single source of truth)

| Internal | Operator label |
|---|---|
| `POOL_SIZE_EXCEEDED` | Jumlah peserta pool melebihi batas maksimum |
| `MEASURE_MISSING` | Data tinggi/berat/sabuk peserta tidak lengkap |
| `MAX_TOLERANCE_EXCEEDED` | Selisih tinggi/berat melebihi batas maksimum yang ditetapkan panitia |
| `BELT_BAND_MISMATCH` | Sabuk peserta berbeda kelompok dalam satu pool |
| `WEIGHT_TOLERANCE_WORSENED` | Selisih berat badan dalam pool melampaui toleransi ideal |
| `HEIGHT_TOLERANCE_WORSENED` | Selisih tinggi badan dalam pool melampaui toleransi ideal |
| `BELT_TOLERANCE_WORSENED` | Selisih tingkat sabuk dalam pool melampaui toleransi ideal |
| `CONTINGENT_CONCENTRATION_WORSENED` | Peserta dari satu kontingen menjadi lebih menumpuk dalam pool |
| `POOL_SIZE_WORSENED` | Ukuran pool menjauhi ukuran yang disarankan |
| `SINGLETON_CREATED` | Terbentuk pool berisi satu peserta (walkover) |

### Command/API error codes (`apps/web/lib/command-error.ts`)

| Internal | Operator label |
|---|---|
| `HARD_CONSTRAINT_VIOLATED` | Perubahan tidak dapat dilakukan karena melanggar ketentuan kategori. |
| `REASON_REQUIRED` | Perubahan ini menurunkan kualitas pengelompokan. Isi alasan untuk melanjutkan. |
| `BRACKET_INVARIANT_VIOLATED` | Perubahan ditolak: susunan bagan yang dihasilkan tidak valid. |
| `ENTRY_NOT_FOUND` | Peserta tidak ditemukan pada revisi ini. |
| `POOL_NOT_FOUND` | Pool tujuan tidak ditemukan pada revisi ini. |
| `REVISION_CONFLICT` | Drawing telah diperbarui oleh pengguna lain. |
| `FORBIDDEN_COMMAND` / `UNAUTHORIZED_TOURNAMENT_ACCESS` | Anda tidak memiliki izin untuk melakukan tindakan ini. *(replaces the current English sentence, §4)* |
| `REVISION_LOCKED` | Revisi ini sudah tidak dapat diubah (dikunci, diterbitkan, atau sedang direvisi). *(replaces the current English sentence, §4)* |

### Export/document types (already translated — `apps/web/components/ExportPanel.tsx:17-24`)

| Internal | Operator label |
|---|---|
| `TOURNAMENT_DRAW_BOOK` | Buku Bagan Turnamen (PDF) |
| `CATEGORY_DRAW` | Bagan Kategori (PDF) |
| `POOL_SHEET` | Lembar Pool (PDF) |
| `BRACKET_SHEET` | Bagan Pertandingan (PDF) |
| `XLSX_WORKBOOK` | Workbook (XLSX) |
| `SEMI_PRESTASI_COMPACT_DRAW_SHEET` | Lembar Drawing Ringkas Semi Prestasi (PDF) |

### Roles (`apps/web/lib/lifecycle.ts:10`)

| Internal | Operator label |
|---|---|
| `VIEWER` | Peninjau |
| `DRAWING_OFFICER` | Petugas Drawing |
| `TECHNICAL_DELEGATE` | Delegasi Teknis |
| `ADMIN` | Admin |

### Participant eligibility / issue status

Already implemented in `apps/web/lib/*` (`eligibilityLabel`, `issueStatusLabel`,
`groupStatusLabel`, `confidenceLabel`) — exact mapping not reproduced here since it was not read
verbatim in this audit pass; flagged in §29 to pull the literal strings into this table before
implementation so there is exactly one dictionary, not two.

---

## 6. Current feature capability matrix

| Feature | Classification | Evidence |
|---|---|---|
| Tournament creation | **MISSING** | No `POST /tournaments` anywhere in `apps/api/src` (confirmed by exhaustive search); no create form in `apps/web`. |
| Tournament list | IMPLEMENTED | `GET /tournaments` (`tournament-list.controller.ts`) + `apps/web/app/tournaments/page.tsx`. |
| Sign-in / session | **MISSING** (dev-only stand-in exists) | `x-actor-id` header pasted by hand; no login, no cookie/JWT (`dev-auth.tsx`, `actor.ts:6-9`). |
| CSV import (browser) | **MISSING** | No multipart/file-upload controller in `apps/api`; parser exists (`packages/intake/src/csv.ts`) but is only invoked from `tools/draw-simulator/src/cli.ts` (a CLI). |
| CSV import (CLI) | SCRIPT_ONLY | `tools/draw-simulator/src/cli.ts:78` etc. |
| Import preview/validation UI | **MISSING** | No corresponding UI; validation *output* is viewable read-only on the Peserta page once data already exists in the DB. |
| Participant list/inspection | IMPLEMENTED | `apps/web/app/tournaments/[id]/peserta/page.tsx`, fully wired, read-only by design. |
| Participant correction (edit a value) | **MISSING** | Peserta page is explicitly read-only (`peserta/page.tsx:146`); no edit endpoint audited/found. |
| Category browsing | IMPLEMENTED | `apps/web/app/tournaments/[id]/categories/page.tsx`. |
| Category filters (discipline/prestasi/age/gender/readiness) | BACKEND_READY or IMPLEMENTED — **unconfirmed exact filter set**, see §29 | `CategoryFilters` component exists; exact filters not enumerated in this pass. |
| Generate drawing (preflight + create) | IMPLEMENTED | `apps/web/app/tournaments/[id]/drawing/page.tsx` + `POST tournaments/:id/draw-runs` (`draw-run.controller.ts:29-87`). |
| Drag-and-drop move | IMPLEMENTED | `PoolCard.tsx:38-50` → `api.moveEntry` → `POST revisions/:id/commands/move-entry` (`revision.controller.ts`). |
| Keyboard move (non-drag alternative) | IMPLEMENTED | `MoveEntryDialog.tsx` calling the same `api.moveEntry`. |
| Swap | IMPLEMENTED | `SwapEntryDialog.tsx` → `api.swapEntry`. |
| Move pool (arena/order) | IMPLEMENTED | `PoolCard.tsx:62-100` → `api.movePool`. |
| Bracket viewing | IMPLEMENTED (read-only) | `BracketView.tsx`. |
| Submit / Approve / Lock / Publish / Amend | IMPLEMENTED | `revision.controller.ts:110-153` + `LifecycleBar.tsx`. |
| Reject / Reopen / Abandon-amendment / Supersede | **MISSING at the API layer** (domain-only) | `RevisionController` has no route for these 4 of the 9 domain actions; exercised only in `packages/domain/src/state-machines.property.test.ts`. |
| Export generation | IMPLEMENTED | `ExportPanel.tsx` → `apps/api/src/export/export.controller.ts`. |
| Export download | IMPLEMENTED | `apps/web/lib/api.ts:435-449` (`downloadExportFile`). |
| Audit history | IMPLEMENTED | `apps/web/app/tournaments/[id]/audit/page.tsx` + `audit.controller.ts:18-41`. |
| Concurrency conflict handling | IMPLEMENTED (at least for lifecycle) | `LifecycleBar.tsx:48-49` handles `REVISION_CONFLICT`. |

**Do not design fiction**: tournament creation and browser-based CSV/XLSX import are the two
capabilities this redesign cannot merely "make prettier" — they require new backend endpoints in
addition to new UI. Every other screen in this document is a redesign of something real.

---

## 7. Proposed information architecture

```
BaganTKD
├─ Semua Turnamen (tournament list — the true landing page)
│   └─ Buat Turnamen
└─ [Turnamen aktif]  (workspace, tournament name always visible)
    ├─ Ringkasan          (home — "what do I do next")
    ├─ Peserta            (import + inspect participants)
    ├─ Kategori           (browse category structure)
    ├─ Drawing            (preflight → workspace: pools/brackets/moves)
    ├─ Dokumen            (exports)
    └─ Riwayat            (audit)
```

Rationale for six top-level sections instead of the current ad-hoc mix: it matches the mandated
operator workflow (§ product goal) almost 1:1 — Peserta covers "Impor Data Peserta" + "Periksa
Data"; Kategori is a browsing aid, not a workflow step on its own; Drawing covers
"Buat Drawing" → "Tinjau Drawing" → "Koreksi" → "Setujui" → "Terbitkan" as one continuous space
(not five separate pages) because in practice an operator moves back and forth between reviewing
and correcting, never in a strict line; Dokumen and Riwayat are terminal/reference views.

---

## 8. Proposed route architecture

```
/turnamen
/turnamen/baru
/turnamen/:id                     (→ redirects to /turnamen/:id/ringkasan)
/turnamen/:id/ringkasan
/turnamen/:id/peserta
/turnamen/:id/kategori
/turnamen/:id/drawing
/turnamen/:id/drawing/:drawRunId  (transient preflight-result state, not a distinct nav destination)
/turnamen/:id/dokumen
/turnamen/:id/riwayat
```

**Recommendation: rename the URL paths to Indonesian** (`/turnamen` not `/tournaments`,
`/peserta`/`/kategori`/`/drawing`/`/dokumen`/`/riwayat`), but **do not rename backend
resources/tables/API paths** — `apps/api`'s routes, `packages/db`'s tables, and internal type names
stay exactly as they are. The `:id`/`:categoryId`/`:drawRunId` segments remain real UUIDs
technically (as they must, to address real backend resources); the requirement is only that the
operator never has to read, copy, or type one — every link that produces these URLs must be
generated by clicking something, never typed.

This is a **frontend-only routing change** (Next.js App Router folder rename), low migration cost,
and directly serves the "Indonesian-first" and "no raw IDs" requirements simultaneously — the URL
itself stops being a place where an English/technical word could leak into what an operator reads
over someone's shoulder or bookmarks.

---

## 9. Operator journey

```
Buka BaganTKD
 → (masuk sesi — lihat §10)
 → Semua Turnamen
 → Buat Turnamen  ATAU  Buka Turnamen yang sudah ada
 → Ringkasan turnamen  ("apa langkah berikutnya?")
 → Peserta → Impor Data Peserta → Periksa Data
 → Kategori (opsional, untuk memahami struktur)
 → Drawing → Buat Drawing (preflight → hasil)
 → Drawing → Tinjau pool/bagan → Koreksi bila perlu (drag/swap/move)
 → Drawing → Setujui → Kunci → Terbitkan
 → Dokumen → cetak/unduh
 → (bila ada keberatan) Drawing → Buat Revisi → ulangi tinjau/setujui/terbitkan
 → Riwayat (kapan saja, untuk melihat siapa mengubah apa)
```

Every arrow above must be a click, never a typed ID and never a piece of knowledge the operator
must already have before starting.

---

## 10. First-run experience

Per the task brief: "define a clean DEVELOPMENT SESSION abstraction so the current actor-ID
development mechanism can be hidden from normal UI while preserving backend authorization
behavior," with real production auth explicitly deferred (per the task's own framing — noting in
§29 that this repository's own phase-numbering does not currently label a specific phase "auth", so
this should be confirmed with whoever owns the roadmap, not assumed).

**Backend authorization is unchanged**: every request still carries `x-actor-id`
(`apps/api/src/auth/actor.ts:6-9`), and `ActorGuard` still resolves the caller's `role` from
`tournament_member` server-side (`actor.guard.ts:54-61`) — nothing here proposes trusting a
client-supplied role, only hiding the raw mechanism from the UI.

**Proposed development session (this phase, replaces `/` and `dev-auth.tsx`):**

1. On first load with no stored session, show a minimal **"Pilih Pengguna Pengembangan"** picker —
   not a raw ID paste box, but a dropdown/list populated from `GET /tournaments/:id/members` for a
   *known* development tournament (seeded), or, if no tournament exists yet, a single obvious
   **"Buat Turnamen"** call to action with a single implicit development actor already assigned
   (e.g. an actor auto-created by the seed script, never asked of the operator).
2. Once a session exists, `x-actor-id` is set exactly as today, just never re-typed by a human —
   it's selected once from a list, or defaulted for solo development.
3. This picker is visually distinct from the eventual production login (bordered, labeled
   "Mode Pengembangan", consistent with today's DEV-AUTH banner intent, but replacing the raw
   text inputs with a selection UI) so nobody mistakes it for the real thing.

**What Phase 7 (or whatever phase eventually owns real auth) replaces:** the picker described above
is swapped for a real login screen (credentials, SSO, or whatever is decided later) that resolves
to the same `x-actor-id`-bearing session under the hood — no other screen in this document changes
when that happens, because every other screen only ever reads "the current actor," never the
mechanism that produced it.

**Explicit functional gap:** none of this removes the need for `tournament_member` rows to exist
before a "user" can be selected — seeding development actors remains a script-only concern until
real auth exists; this document does not invent user *registration*.

---

## 11. Tournament creation specification

**Functional gap, stated plainly:** this requires a new `POST /tournaments` API endpoint. It does
not exist today (§6). The specification below is written assuming that endpoint is added; the
fields listed are deliberately minimal and limited to what a tournament record plausibly needs to
exist at all — inventing more would violate "do not invent required fields that backend/domain does
not currently support."

**Buat Turnamen**

| Field | Required | Notes |
|---|---|---|
| Nama Turnamen | ya | free text |
| Tanggal mulai / selesai | ya | date range |
| Lokasi | ya | free text |
| Kode singkat | tidak | only if the domain already has a concept of a short code (confirm against `tournament` schema before implementing — do not invent one) |

Flow: `Buat Turnamen` (button, from `/turnamen`) → form → `Simpan` → the new tournament opens
directly at its **Ringkasan** page. The tournament's internal id is generated by the backend and
never shown as the primary identifier anywhere in the UI (the name is).

---

## 12. CSV/XLSX import specification

**Functional gap, stated plainly:** this requires a new file-upload endpoint in `apps/api` (the
parser in `packages/intake/src/csv.ts` already exists and can be reused — this is an API/UI gap,
not a parsing-logic gap). Distinguishing the four categories from §9 of the task brief:

- **(A) already implemented, browser-reachable:** none.
- **(B) backend capability without operator UI:** the intake pipeline (`packages/intake`) itself —
  parsing, validation, normalization rules all exist and are exercised by tests/CLI; what's missing
  is a way to hand it bytes from a browser.
- **(C) development/import scripts only:** `tools/draw-simulator/src/cli.ts` — the only current way
  CSV data reaches the system.
- **(D) completely missing:** XLSX *reading* (only XLSX *writing*, for export, exists —
  `packages/export/src/xlsx.ts`). If XLSX upload is required, an XLSX parser must be added; this
  document does not assume one exists.

### Proposed flow

```
Peserta
 → Impor Data Peserta
 → pilih file (CSV; XLSX only if a parser is confirmed/added — see gap above)
 → pratinjau (preview, client-uploads-then-server-parses — never parsed in-browser, so the exact
   same validation rules the intake pipeline already enforces apply, with zero duplicated logic)
 → validasi ditampilkan
 → konfirmasi impor
 → hasil: baris berhasil / perlu diperiksa / tidak dapat diproses
```

### Import preview screen content (uses only validation rules the intake pipeline already implements — see `docs/ACCEPTANCE_CRITERIA.md` §Phase 2 issue list for the authoritative set, e.g. `HEIGHT_MISSING`, `WEIGHT_CLASS_MISMATCH`, `NIK_INVALID_FORMAT`, etc. — this document does not invent new ones)

```
Impor Data Peserta

File: pendaftaran-piala-gubernur.xlsx
3.154 baris ditemukan

3.066 siap diimpor
39 perlu diperiksa
49 tidak dapat diproses

[ Periksa Masalah ]   [ Batal ]   [ Lanjutkan Impor ]
```

### Failure/edge cases

| Case | Operator-facing behavior |
|---|---|
| Invalid file format | "Berkas tidak dapat dibaca. Pastikan file berformat CSV/XLSX sesuai templat." — never a parser stack trace. |
| Required columns missing | "Kolom wajib tidak ditemukan: [nama kolom]." listing the specific missing column(s) using the template's own column names, never a schema/field identifier. |
| Duplicate rows | Flagged per-row in the preview as "Kemungkinan duplikat", never silently merged or silently dropped. |
| Suspicious values | Surfaced exactly as the existing issue codes already describe them (§13), never a new heuristic invented here. |
| Mixed valid/invalid rows | The 3-bucket summary above (siap / perlu diperiksa / tidak dapat diproses) — valid rows are never blocked by invalid ones; the operator chooses to proceed with only the valid rows. |
| Thousands of rows | Preview must be paginated/virtualized, not rendered as one giant table — reuse whatever pagination approach the Peserta list already uses. |

**Template question (open, §29):** does the importer expect one fixed column template, or does it
need column mapping? This document does not invent a flexible mapper unless the intake pipeline
already tolerates varying column names — this needs a direct read of `packages/intake/src/pipeline.ts`
before the screen spec is finalized; assumed fixed-template for now (simpler, matches "do not invent
a flexible mapper unless it is actually needed").

---

## 13. Validation workflow

Severity presentation (color + text + icon, never color alone, matching the existing
`StatusBadge` pattern of icon+text):

| Severity | Presentation | Meaning |
|---|---|---|
| Merah | ✕ + red | Harus diperbaiki sebelum data ini dapat digunakan pada operasi terkait (mis. tidak dapat masuk kategori). |
| Kuning | ⚠ + amber | Perlu diperiksa; dapat tetap diproses tapi operator harus sadar akan potensi masalah. |
| Biru/abu | ℹ + gray | Informasi, tidak memerlukan tindakan. |

Message format (translate, do not invent new validation behavior): a short bold headline plus one
plain sentence of context, following the pattern already established in the task brief and
consistent with how `impact-labels.ts` writes its explanations — e.g. for an existing issue code
like `HEIGHT_OUT_OF_RANGE`:

```
Tinggi badan perlu diperiksa
Nilai yang tercatat terlihat tidak wajar untuk kategori usia ini.
```

This document does not enumerate a full 1:1 translation of every issue code in
`docs/ACCEPTANCE_CRITERIA.md`'s Phase 2 table — that belongs in the terminology dictionary (§5) as
an implementation task, seeded from the codes already listed there (`HEIGHT_MISSING`,
`WEIGHT_MISSING`, `HEIGHT_WEIGHT_LIKELY_SWAPPED`, `BMI_IMPLAUSIBLE`, `WEIGHT_CLASS_MISMATCH`,
`AGE_DIVISION_PLAY_UP`, `NIK_INVALID_FORMAT`, `NIK_GENDER_MISMATCH`, `NIK_BIRTHDATE_MISMATCH`,
`DOB_POSSIBLE_PLACEHOLDER`, `ATHLETE_ATTRIBUTE_CONFLICT`, `ATHLETE_MULTIPLE_CONTINGENTS`,
`CLASS_FORMAT_NORMALIZED`).

---

## 14. Participant management specification

The existing Peserta page (§2, route 5) is the right foundation — read-only by design, already
Indonesian, already has eligibility/issue labels. Additions needed:

- Entry point to Import (§12), visible when the operator has permission to modify data for this
  tournament's current revision state.
- Columns, confirmed against the existing table (`peserta/page.tsx:267-277`): Peserta, Kontingen,
  Disiplin, Kategori, Status pendaftaran, Kelayakan, Masalah data — matches the task brief's
  proposed column set closely enough that no changes are needed beyond visual polish; **TB/BB
  are not currently columns on this table** (only Kategori/Sabuk-adjacent data appears via
  eligibility/issues) — if TB/BB are wanted as visible columns, that's a small, low-risk addition
  since the data is already fetched at the export layer.
- Filters already exist: q (search), contingent, discipline, category, eligibility, hasIssues —
  matches "Semua / Siap / Perlu Diperiksa / Bermasalah" from the brief closely; confirm the exact
  filter option labels read as natural Indonesian (not literally checked in this pass, §29).
- Pair/Team grouping is already shown (`peserta/page.tsx:95`, "Pengelompokan: ...") — keep, polish
  visual presentation only.

---

## 15. Category specification

Matches the task brief's example format closely; source data already exists
(`categories/page.tsx:90-100`). Redesign target:

```
Kyorugi Semi Prestasi
Pra Cadet C Putra · Under 41 kg
43 peserta · 12 pool
Siap
```

Replace the current raw table headers/values (§4) with translated labels and the readiness/quality
dictionary (§5). Filters: Kyorugi/Poomsae, Prestasi/Semi-Prestasi, age division, gender, readiness —
confirm `CategoryFilters`'s actual current filter set before assuming all of these already exist
(§29); do not invent filters the component doesn't support without flagging it as new work.

Category keys (`category_key`) stay entirely internal — never rendered; the human title
(`formatOperatorCategoryTitle`-equivalent, already used by the export layer) is the only identity
shown.

---

## 16. Drawing generation specification

Preflight screen (replaces current `/tournaments/[id]/drawing`):

```
238 kategori
207 siap
31 belum siap

3.066 peserta dapat diproses
49 peserta perlu diperiksa

[ Buat Drawing ]
```

"Seed" and "Jenis drawing" (Kandidat/Simulasi) move behind an **"Opsi Lanjutan"** disclosure,
collapsed by default — the vast majority of operator-initiated draws need neither, and exposing them
by default asks an operator to make a determinism/engine-strategy decision they have no context for.
Engine strategy names are never shown in the primary flow, matching the brief's "unless an advanced
technical view explicitly requires them."

After generation:

```
Drawing berhasil dibuat.

228 kategori diproses
10 perlu perhatian
0 diblokir

[ Tinjau Drawing ]
```

This result view **replaces** the standalone `/draws/[drawRunId]` destination (§2, route 9) — it's
a transient step inside the Drawing flow, not a page an operator navigates back to. Fingerprints
move to a "Lihat Detail Teknis" disclosure, never the primary content.

---

## 17. Drawing Workspace specification

See §34-equivalent detail in the task brief; full layout spec is in §27 (Screen I) and elaborated
below.

The workspace **is** the redesigned `/categories/[categoryId]` page (§2, route 7) plus the category
list (§2, route 6) folded into one persistent left-hand navigator, so switching categories never
means leaving the workspace and losing pool/bracket context — this directly serves "the operator
must be able to choose category [and] see pools" as one continuous action, not two page loads.

Core interactions preserved exactly as implemented today (server-authoritative, unchanged):
`MoveEntry` (drag or dialog), `SwapEntries` (dialog), `MovePool` (inline form). See §18 for the
human presentation of their verdicts.

---

## 18. Drag/drop and manual correction UX

Preserve `MoveEntry`/`SwapEntries` exactly as implemented (`PoolCard.tsx`, `MoveEntryDialog.tsx`,
`SwapEntryDialog.tsx`, all server-authoritative via the existing command endpoints). Human
presentation per verdict, using the dictionary in §5:

**GREEN (Aman):** apply immediately, toast: "Peserta berhasil dipindahkan."

**YELLOW (Perlu Perhatian):**
```
Perpindahan ini perlu diperiksa.

[human explanation via describeImpactCodes(), already implemented in impact-labels.ts]

Alasan perubahan
[........................]

[ Batal ]   [ Tetap Pindahkan ]
```

**RED (Tidak Dapat Diterapkan):**
```
Peserta tidak dapat dipindahkan.

[human explanation via describeImpactCodes()]

[ Tutup ]
```

No raw error code is ever the headline message — `impact-labels.ts` and `command-error.ts` already
implement exactly this translation; the redesign's job is to make sure the *dialog chrome* around
these existing translated strings looks like the above, consistently, everywhere a verdict can
occur (drag drop, Move dialog, Swap dialog — currently each may render this differently; needs
direct visual confirmation, §29).

Keyboard/non-drag alternative (`MoveEntryDialog.tsx`) already exists and must remain available —
this is not a gap, just something to keep from being dropped during visual redesign.

---

## 19. Review/approval/publish workflow

Replace the raw `LIFECYCLE_STEPS.map` badge row (`LifecycleBar.tsx:59-63`) with the translated
stepper from §5's lifecycle table. Confirmation dialogs for irreversible actions, per the brief:

```
Kunci Drawing

Setelah dikunci, susunan pertandingan tidak dapat diubah tanpa membuat
revisi baru.

[ Batal ]   [ Kunci Drawing ]
```

```
Terbitkan Drawing

Drawing yang diterbitkan akan menjadi acuan dokumen resmi pertandingan.

[ Batal ]   [ Terbitkan ]
```

**Functional note:** Reject/Reopen/Abandon-amendment are domain-valid transitions with **no current
API route** (§6). If the redesigned UI is meant to expose "Tolak" (send back to Draf) or "Buka
Kembali" as real operator actions, the corresponding `apps/api` endpoints must be added first — this
document flags it as a gap, it does not assume the button can simply be added to
`LifecycleBar.tsx`.

---

## 20. Revision/objection workflow

```
Revisi 1
Diterbitkan

Revisi 2
Sedang Dikerjakan
```

```
Revisi 1
Digantikan oleh Revisi 2
```

`Amend` already exists end-to-end (`LifecycleBar.tsx`'s amend branch → `api.amend`) and is the
correct mechanism — the redesign only needs to present it as "Buat Revisi" (§5) with a required
reason field (already present, `amendReason`) and translate its two supporting English strings
(`LifecycleBar.tsx:78-79`, §4). `parent_revision_id`/supersede internals stay server-side; the
`auditDetail()` helper already renders "Digantikan oleh revisi ..." for `LIFECYCLE_SUPERSEDE`
events (`audit-detail.ts:6-7`) — reuse this exact pattern for the revision-history presentation
above rather than inventing new copy.

---

## 21. Documents workflow

`ExportPanel.tsx` already implements human document names, a Preview/Resmi indicator, generation
status, download, and history (§2, route confirmation) — this is the least-broken part of the
current app. The redesign's job here is purely visual integration into the new **Dokumen** tab
(currently `ExportPanel` is embedded piecemeal on the Overview and Category pages, not a
destination of its own) — consolidate into one Dokumen screen per tournament/category scope, using
the exact same human names already defined (§5's export table). No change to PDF rendering
(explicitly out of scope) and no change to the export API.

---

## 22. History/audit workflow

```
14:32
Ega memindahkan Andi Saputra
Pool 2 → Pool 4

Alasan:
Penyesuaian setelah keberatan kontingen.
```

`auditDetail()` (`apps/web/lib/audit-detail.ts`) already produces exactly this kind of human detail
for verdicts and supersede events — extend the same function/pattern to cover every `action` value
the audit endpoint returns (MOVE_ENTRY, SWAP_ENTRIES, MOVE_POOL, and every lifecycle action), so the
**Action** column itself (not just the Detail column) never shows a raw constant. Technical
detail (full hash, raw before/after JSON) stays behind a "Detail Teknis" expansion, never the
primary row.

---

## 23. Navigation specification

Top-level tournament nav (persistent inside a tournament workspace):

```
Ringkasan · Peserta · Kategori · Drawing · Dokumen · Riwayat
```

Plus, always visible: `← Semua Turnamen` and the current tournament's name (never its id).
Breadcrumbs, where used, are built from human names only (tournament name → category human title →
pool ordinal) — never a UUID segment, matching §8's routing principle. No duplicate navigation
(e.g. `ExportPanel` should not also carry its own tournament-switcher) and no dashboard links
unrelated to the six sections above.

---

## 24. Responsive behavior

Primary target: desktop/laptop, 1366×768 minimum, 1920×1080 comfortable (per the brief). The
Drawing Workspace (§17, §27 Screen I) is the one screen that must be explicitly verified against
1366×768 during implementation — three-column layouts (nav / pools / inspector) are the most likely
to break first at that width; collapsing the right-hand inspector into an on-demand panel (opened
by selecting an entry, not permanently docked) is the recommended fallback if three fixed columns
don't fit comfortably. Mobile is explicitly not a target for the workspace; read-only inspection
(Ringkasan, Riwayat, Dokumen) may reasonably work on a tablet/phone as a side effect of using
ordinary responsive layout, but this is not a design goal to actively pursue in this phase.

---

## 25. Accessibility requirements

Carry forward what already exists and is correct — do not regress it during redesign:

- Icon+text status (never color alone) — already the pattern in `StatusBadge.tsx`; just needs its
  *labels* translated (§4), not its accessible structure changed.
- Keyboard-reachable Move/Swap dialogs already exist alongside drag-and-drop — preserve both paths
  for every future drag interaction added during redesign, never drag-only.
- Semantic buttons — already used in `LifecycleBar.tsx`/dialogs; keep.
- `aria-label`s exist (e.g. `LifecycleBar.tsx:78`) — keep the pattern, just translate the label text
  itself to Indonesian consistent with the rest of the UI (an aria-label in English while its
  visible sibling text is Indonesian is itself an inconsistency to fix).
- Focus states, tab order, and contrast were not directly audited in this pass (no CSS was read) —
  flagged in §29 as needing a dedicated pass once visual redesign begins, since this document
  explicitly does not touch CSS.

---

## 26. Loading/empty/error/concurrency states

Define once, apply everywhere (no route audited today has a fully consistent set):

| State | Presentation |
|---|---|
| Loading | skeleton rows matching the eventual table shape, not a generic spinner-only screen, for any list (Peserta, Kategori, Riwayat). |
| Empty | a sentence explaining *why* it's empty and the one action that fixes it (e.g. Peserta empty → "Belum ada data peserta. [Impor Data Peserta]"), never a bare "No data." |
| Success | inline toast/banner in Indonesian, dismissible, e.g. "Peserta berhasil dipindahkan." |
| Warning (YELLOW) | modal/dialog per §18, never a silent partial success. |
| Blocked/error (RED) | modal/dialog per §18, with the human explanation always present, technical code always available behind a details toggle, never as the headline. |
| Stale/concurrent update | "Drawing telah diperbarui oleh pengguna lain. [ Muat Ulang Perubahan ]" — this exact pattern already exists for lifecycle actions (`LifecycleBar.tsx:48-49` handles `REVISION_CONFLICT`); extend it to every mutating action in the Drawing Workspace (move/swap/move-pool), which was not confirmed to have the same handling in this pass (§29). |

---

## 27. Screen-by-screen specifications

### A. Tournament List (`/turnamen`)
- Title: Turnamen
- Purpose: entry point; choose or create a tournament.
- Primary CTA: Buat Turnamen
- Secondary: search (if tournament count grows beyond a glance), sort by date
- Main sections: list of tournament rows (name, dates, location, participant count, drawing status)
- Filters: none needed at current expected scale; add search if it becomes needed
- Status presentation: drawing lifecycle label (§5) as a small badge per row
- Empty state: "Belum ada turnamen. [ Buat Turnamen ]"
- Important state: none beyond empty/loading
- Next step: open a tournament → Ringkasan

### B. Create Tournament (`/turnamen/baru`)
- Title: Buat Turnamen
- Purpose: create a new tournament record (functional gap, §11)
- Primary CTA: Simpan
- Secondary: Batal
- Main sections: single form (§11 fields)
- Empty/error state: inline field validation only; no destructive states
- Next step: redirect to the new tournament's Ringkasan

### C. Tournament Summary — Ringkasan (`/turnamen/:id/ringkasan`)
- Title: tournament name (always visible, never the id)
- Purpose: "what do I do next" (§8 of the brief)
- Primary CTA: contextual — "Periksa Data", "Buat Drawing", or "Lanjutkan Peninjauan" depending on
  state (§8 examples)
- Secondary: links into Peserta/Kategori/Drawing/Dokumen
- Main sections: Data Peserta summary card, Drawing status card — both action-oriented per the
  brief's examples, not decorative KPIs
- Empty state: "Drawing belum dibuat. [ Buat Drawing ]"
- Important state: data-quality warning banner when `perlu diperiksa` count > 0
- Next step: whichever the primary CTA points to

### D. Participant Import (`/turnamen/:id/peserta` → Impor Data Peserta)
- Title: Impor Data Peserta
- Purpose: get a CSV/XLSX of registrations into the system (functional gap, §12)
- Primary CTA: pilih berkas
- Secondary: Batal
- Main sections: file picker, format/template help text
- Empty state: n/a (this screen IS the empty-state remedy for Peserta)
- Important error state: invalid file format, missing columns (§12 table)
- Next step: Import Preview (screen E)

### E. Import Preview / Validation
- Title: Impor Data Peserta (continued)
- Purpose: show what will happen before committing
- Primary CTA: Lanjutkan Impor
- Secondary: Periksa Masalah, Batal
- Main sections: 3-bucket summary (siap / perlu diperiksa / tidak dapat diproses), per-row problem
  list behind "Periksa Masalah"
- Status presentation: severity per §13
- Empty state: n/a
- Important state: 0 siap (nothing importable) blocks "Lanjutkan Impor"
- Next step: confirm → Peserta list (screen F), now populated

### F. Participant List (`/turnamen/:id/peserta`)
- Title: Peserta
- Purpose: operational inspection (§14) — already exists, redesign is visual + add import entry point
- Primary CTA: Impor Data Peserta
- Secondary: search/filter (existing), export-adjacent actions if any
- Main sections: filter bar, table (§14 columns)
- Filters: Semua / Siap / Perlu Diperiksa / Bermasalah + discipline/category (existing)
- Status presentation: eligibility badges (existing, keep)
- Empty state: "Belum ada data peserta. [ Impor Data Peserta ]"
- Next step: Kategori, or fix flagged issues (re-import or, if/when editing exists, correct inline)

### G. Categories (`/turnamen/:id/kategori`)
- Title: Kategori
- Purpose: browse tournament structure (§15)
- Primary CTA: click a row → opens that category inside the Drawing Workspace
- Secondary: filters (Kyorugi/Poomsae, Prestasi/Semi-Prestasi, age, gender, readiness)
- Main sections: filterable table/list, human category titles only
- Status presentation: Siap/Diblokir (§5), quality badge (§5)
- Empty state: "Kategori akan muncul setelah data peserta diperiksa." (categories are derived, not
  manually created — confirm this framing against actual domain behavior, §29)
- Next step: Drawing Workspace for the selected category

### H. Drawing Preflight (`/turnamen/:id/drawing`)
- Title: Drawing
- Purpose: pre-generation readiness check + trigger generation (§16)
- Primary CTA: Buat Drawing
- Secondary: Opsi Lanjutan (collapsed: jenis drawing, seed)
- Main sections: category readiness counts, participant readiness counts
- Empty/blocked state: if 0 kategori siap, disable Buat Drawing with an explanation
- Next step: generation result (transient, folds into Workspace) → Drawing Workspace

### I. Drawing Workspace (`/turnamen/:id/drawing`, category selected) — see §34 detail below

### J. Manual Move / Warning Dialog
- Title: contextual ("Perpindahan ini perlu diperiksa." / "Peserta tidak dapat dipindahkan.")
- Purpose: present a move/swap verdict (§18)
- Primary CTA: Tetap Pindahkan (YELLOW) or none (RED, only Tutup)
- Secondary: Batal
- Main sections: human explanation (via `describeImpactCodes`), reason field (YELLOW only)
- Next step: apply (GREEN/YELLOW-confirmed) or return to workspace unchanged (RED/cancelled)

### K. Review / Approval
- Not a separate route — a mode of the Drawing Workspace, surfaced via the lifecycle stepper (§19)
- Primary CTA: whatever the current stage's next action is (Ajukan/Setujui/Kunci/Terbitkan)
- Secondary: view quality summary, view flagged categories
- Important state: confirmation dialogs for Lock/Publish (§19)

### L. Documents (`/turnamen/:id/dokumen`)
- Title: Dokumen
- Purpose: generate/preview/download official documents (§21)
- Primary CTA: Buat Dokumen (per type)
- Secondary: history of previously generated documents
- Main sections: document type list (§5's export table), Preview/Resmi toggle
- Empty state: "Belum ada dokumen dibuat untuk revisi ini."
- Next step: download, or return to Drawing if a document reveals a problem

### M. Revision History (`/turnamen/:id/riwayat`)
- Title: Riwayat
- Purpose: audit trail (§22)
- Primary CTA: none (read-only)
- Secondary: Muat Peristiwa Lama (pagination)
- Main sections: chronological event list, human action/detail text
- Empty state: "Belum ada riwayat perubahan."
- Next step: n/a (terminal/reference screen)

---

## 28. Feature gaps requiring implementation

Ordered by blocking severity for the stated primary workflow:

1. **Tournament creation** — no API, no UI. Blocks the entire workflow from starting without direct
   DB access. (§6, §11)
2. **Browser-based participant import** — no API, no UI (CLI-only today). Blocks "Impor Data
   Peserta" entirely. (§6, §12)
3. **Development session picker** — UI-only gap; backend already supports it via existing
   `tournament_member`/actor mechanics. (§10)
4. **Lifecycle Reject/Reopen/Abandon-amendment** — domain-valid, no API route. Only needed if the
   redesign intends to expose these as operator actions; if the operator journey never needs to
   "reject" or "reopen," this can stay deferred. (§6, §19)
5. **Terminology translation pass** — no new capability, but real work: every item in §4's table,
   applied consistently app-wide via the §5 dictionary.
6. **Category filter set confirmation** — verify `CategoryFilters`'s actual options against §15/§13
   of the task brief; extend only if genuinely missing. (§29)
7. **Concurrency handling on Drawing Workspace mutations** — confirm move/swap/move-pool already
   handle `REVISION_CONFLICT` the same way lifecycle actions do; extend if not. (§26, §29)

---

## 29. UX risks / unanswered business questions

1. This repository's own phase numbering (`docs/ACCEPTANCE_CRITERIA.md` §4) does not label a
   specific phase "authentication" — the task brief's framing of "production authentication belongs
   to Phase 7" should be confirmed with whoever owns the roadmap rather than assumed from this
   audit; the only auth-adjacent forward reference found in the repo is a security-review mention
   for Phase 7 in `docs/PHASE0_PROPOSAL.md:351`, not a dedicated auth plan.
2. Does the intake pipeline (`packages/intake/src/pipeline.ts`) tolerate varying CSV column names,
   or does it require one fixed template? This determines whether §12's import screen needs a
   column-mapping step or can assume a fixed template. Not confirmed in this pass.
3. Exact current filter options on `CategoryFilters` and the Peserta page's filter dropdowns were
   not read verbatim — needed before finalizing §14/§15 as "already implemented, just needs visual
   polish" versus "needs new filter options added."
4. Does `MoveEntry`/`SwapEntries`/`MovePool` already surface `REVISION_CONFLICT` the same way
   `LifecycleBar` does, or only lifecycle actions currently handle it? Needed to know whether §26's
   concurrency row is a gap or already covered.
5. Is a tournament "short code" a real domain concept (worth asking for at creation) or would this
   invent a field the backend doesn't have? Flagged, not assumed, in §11.
6. Should Reject/Reopen/Abandon-amendment ever be operator-reachable, or are they intentionally
   internal-only safety valves? This changes whether §28 item 4 is real scope or can be dropped.
7. The audit page's **Action** column's exact current rendering (translated or raw) was not
   directly confirmed with a screenshot/read of the render output — only inferred from
   `auditDetail()`'s scope (which covers the Detail column, not necessarily Action). Needs
   confirmation before implementation.
8. TB/BB (height/weight) as explicit Peserta-list columns: useful per the task brief's example, but
   not currently rendered there — worth confirming operators actually want them on this list versus
   relying on the eligibility/issue summary that already surfaces problems with those values.

---

## 30. Recommended implementation slices

Ordered to unblock the primary workflow as early as possible, each slice independently shippable:

1. **Terminology pass** (§4, §5) — no new capability, lowest risk, immediately improves every
   existing screen. Do first; it's pure translation/labeling work on already-correct data flows.
2. **Development session picker** (§10) — removes the UUID-paste front door without waiting on real
   auth; unblocks realistic day-to-day use of everything that already works.
3. **Tournament creation** (§11) — smallest new-capability slice (one form, one endpoint); unblocks
   starting a tournament without DB access.
4. **Participant import** (§12) — largest new-capability slice (upload endpoint + preview UI +
   reusing existing validation); this is the one that turns "the engine works" into "an operator
   can actually run a tournament," so it should not be delayed past #3.
5. **Categories/Peserta visual redesign** (§14, §15) — polish over already-working data flows.
6. **Drawing Preflight + Workspace redesign** (§16, §17, §27 Screen I) — the largest visual/layout
   effort; sequence after #1 so the workspace is built with correct terminology from the start
   rather than redesigned twice.
7. **Lifecycle/Documents/History visual + terminology consolidation** (§19, §21, §22) — lower risk,
   can proceed in parallel with #6 once #1 is done.
8. **Gap-dependent items** (Reject/Reopen/Abandon-amendment, if confirmed needed per §29 Q6) — only
   after product confirms they're in scope.

---

## Concise report

- **Routes audited:** 7 top-level routes (plus 1 shared tournament layout), all under
  `apps/web/app/**` (App Router; no `pages/` directory exists).

- **Biggest 10 UX problems** (see §3 for full detail):
  1. No way to create a tournament (no API, no UI).
  2. No way to import participant data from a browser (CLI-only today).
  3. Front door requires pasting two raw UUIDs from memory.
  4. Lifecycle status shown as raw enum text in two places while adjacent UI is fully translated.
  5. Two hardcoded English sentences inside the Indonesian error-translation layer.
  6. Role names leak raw into UI copy ("Requires TECHNICAL_DELEGATE+").
  7. Quality verdicts labeled in English (`OK`/`Warning`/`Blocked`) despite an existing correct
     Indonesian pattern one file away.
  8. A whole page dedicated to SHA-256 fingerprints with no operational value.
  9. Peserta unreachable from the main tab bar (Overview/Categories/Audit only).
  10. No screen currently frames "what do I do next" as a first-class concept.

- **Proposed top-level navigation:** Ringkasan · Peserta · Kategori · Drawing · Dokumen · Riwayat,
  plus a persistent "← Semua Turnamen" and the tournament's name (never its id).

- **Recommended operator journey:** Buat/Pilih Turnamen → Impor Data Peserta → Periksa Data →
  Kategori → Buat Drawing → Tinjau Drawing → Koreksi → Setujui → Kunci → Terbitkan → Dokumen →
  Cetak, with Riwayat available at every step.

- **Features already usable today** (real, server-authoritative, just need visual/terminology
  polish): tournament list, participant inspection (read-only), category browsing, drawing
  generation (preflight + create), drag-and-drop move + keyboard alternative, swap, move-pool,
  bracket viewing, submit/approve/lock/publish/amend, export generation + download, audit history.

- **Features requiring frontend work only:** development session picker (§10); terminology/label
  translation pass (§4, §5); Drawing Workspace visual consolidation (§17); Documents consolidation
  into one screen (§21).

- **Features requiring backend work:** tournament creation (`POST /tournaments`, §11); browser-based
  CSV/XLSX import (upload endpoint, reusing the existing `packages/intake` parser/pipeline, §12);
  Reject/Reopen/Abandon-amendment lifecycle endpoints, only if confirmed in scope (§28, §29 Q6).

- **Technical terms that must disappear from normal UI:** `DRAFT`/`REVIEW`/`APPROVED`/`LOCKED`/
  `PUBLISHED`/`AMENDED`/`SUPERSEDED` (raw), `GREEN`/`YELLOW`/`RED` (raw), `READY`/`BLOCKED` (raw),
  role names (`TECHNICAL_DELEGATE` etc.), raw SHA-256 fingerprints in the primary flow, raw UUIDs
  anywhere a human reads the screen, English button labels ("Submit for review", "Approve", "Lock",
  "Publish", "Amend", "Dismiss", "Load older events"), the two hardcoded English error sentences in
  `command-error.ts`.

- **Unanswered business questions:** see §29 in full — most consequential are (1) whether "Phase 7 =
  auth" is confirmed with the roadmap owner or just an assumption, and (2) whether the intake
  pipeline needs column-mapping or can assume a fixed CSV/XLSX template.

- **Recommended implementation order:** terminology pass → dev session picker → tournament creation
  → participant import → Peserta/Kategori polish → Drawing Preflight/Workspace redesign →
  Documents/History consolidation → gap-dependent lifecycle actions (if confirmed in scope).

---

*This document is an audit and specification only. No React components, CSS, routes, migrations,
API, auth, engine, or export code were changed to produce it.*
