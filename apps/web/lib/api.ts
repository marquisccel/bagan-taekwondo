/**
 * Thin fetch client for the Phase 4 API (apps/api). No mutation of local authoritative state:
 * every read comes back from the server, every write goes through a command endpoint and the
 * caller re-fetches. DEV AUTH ONLY: identity is an `x-actor-id` header, not a real session — see
 * lib/dev-auth.tsx.
 */
export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3000';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Optional structured context of a refusal (e.g. the command verdict); never a stack trace. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, actorId: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-actor-id': actorId },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const b = body as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiClientError(
      res.status,
      b?.code ?? 'UNKNOWN_ERROR',
      b?.message ?? res.statusText,
      b?.details,
    );
  }
  return body as T;
}

const get = <T>(path: string, actorId: string) => request<T>(path, actorId);
const post = <T>(path: string, actorId: string, body: unknown) =>
  request<T>(path, actorId, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, actorId: string, body: unknown) =>
  request<T>(path, actorId, { method: 'PATCH', body: JSON.stringify(body) });

// ---------------------------------------------------------------------------------------
// Response shapes (subset of the backend's actual columns — see apps/api/src/**/*.controller.ts)
// ---------------------------------------------------------------------------------------

export interface TournamentSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly eventStart: string;
  readonly eventEnd: string;
  readonly totalEntries: number;
  readonly totalContingents: number;
  readonly activeRuleSetStatus: string;
  readonly latestDrawRun: {
    readonly id: string;
    readonly status: string;
    readonly kind: string;
    readonly requestedAt: string;
    readonly finishedAt: string | null;
  } | null;
  readonly latestRevision: {
    readonly id: string;
    readonly revision_no: number;
    readonly lifecycle: string;
    readonly lock_version: number;
  } | null;
  readonly categoryCounts: { readonly total: number; readonly ready: number; readonly blocked: number };
  readonly warningCount: number;
  readonly errorCount: number;
}

export interface TournamentMember {
  readonly user_id: string;
  readonly role: 'VIEWER' | 'DRAWING_OFFICER' | 'TECHNICAL_DELEGATE' | 'ADMIN';
  readonly display_name: string;
  readonly email: string;
}

export interface DrawRun {
  readonly id: string;
  readonly tournament_id: string;
  readonly rule_set_id: string;
  readonly kind: string;
  readonly status: 'QUEUED' | 'RUNNING' | 'SAFE' | 'UNSAFE' | 'FAILED';
  readonly seed: string;
  readonly engine_version: string;
  readonly rules_fingerprint: string;
  readonly input_fingerprint: string;
  readonly output_fingerprint: string | null;
  readonly scope: readonly string[];
  readonly unsafe_reasons: readonly unknown[];
  readonly dual_run_match: boolean | null;
  readonly duration_ms: number | null;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

export interface QualityReport {
  readonly report: unknown;
  readonly fingerprint: string;
  readonly error_count: number;
  readonly warning_count: number;
  readonly info_count: number;
}

export interface RevisionDetail {
  readonly id: string;
  readonly tournament_id: string;
  readonly draw_run_id: string;
  readonly revision_no: number;
  readonly parent_revision_id: string | null;
  readonly lifecycle: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'LOCKED' | 'PUBLISHED' | 'AMENDED' | 'SUPERSEDED';
  readonly content_fingerprint: string | null;
  readonly lock_version: number;
  readonly created_at: string;
  readonly submitted_at: string | null;
  readonly approved_at: string | null;
  readonly locked_at: string | null;
  readonly published_at: string | null;
}

export type Quality = 'GREEN' | 'YELLOW' | 'RED';

export interface CategorySummary {
  readonly category_id: string;
  readonly category_key: string;
  readonly stream: string;
  readonly discipline: string;
  readonly format: string;
  readonly gender: string;
  readonly movement: string | null;
  readonly readiness: 'READY' | 'BLOCKED';
  readonly blocked_reasons: readonly unknown[];
  readonly selected_strategy: string | null;
  readonly poolCount: number;
  readonly entryCount: number;
  readonly quality: Quality;
}

export interface EntryDisplay {
  readonly entryId: string;
  readonly externalRef: string | null;
  readonly contingent: string;
  readonly displayName: string;
  readonly athletes: readonly {
    readonly fullName: string | null;
    readonly gender: string | null;
    readonly weightG: number | null;
    readonly heightMm: number | null;
    readonly beltCode: string | null;
    /** The rule set's own human wording for the belt (e.g. "Geup 9 (kuning)"), resolved server-side
     * from `rule_belt.label` — never re-derive this from `beltCode` client-side. */
    readonly beltLabel: string | null;
  }[];
}

export interface BracketSlot {
  readonly position: number;
  readonly entry_id: string | null;
  readonly seed_no: number | null;
  readonly bye_reason: unknown;
  readonly entry: EntryDisplay | null;
}

export type MatchFeeder =
  | { readonly kind: 'slot'; readonly slot: number }
  | { readonly kind: 'match'; readonly publicCode: string | null };

export interface BracketMatch {
  readonly id: string;
  readonly matchUid: string;
  readonly round: number;
  readonly position: number;
  readonly publicCode: string | null;
  readonly displayNo: number | null;
  /** Auto-assigned "No." when the team hasn't manually set one — see resolveMatchNumbers in @bagantkd/shared. */
  readonly resolvedDisplayNo: number | null;
  readonly status: string;
  readonly feederA: MatchFeeder;
  readonly feederB: MatchFeeder;
}

export interface Bracket {
  readonly id: string;
  readonly size: number;
  readonly rounds: number;
  readonly entries: number;
  readonly byes: number;
  readonly slots: readonly BracketSlot[];
  readonly matches: readonly BracketMatch[];
}

export interface PoolDetail {
  readonly id: string;
  readonly poolUid: string;
  readonly ordinal: number;
  readonly isWalkover: boolean;
  readonly metrics: unknown;
  readonly explanation: readonly unknown[];
  readonly members: readonly EntryDisplay[];
  readonly bracket: Bracket | null;
}

export interface CategoryDetail {
  readonly category: {
    readonly id: string;
    readonly category_key: string;
    readonly stream: string;
    readonly discipline: string;
    readonly format: string;
    readonly gender: string;
    readonly movement: string | null;
  };
  readonly readiness: 'READY' | 'BLOCKED';
  readonly blockedReasons: readonly unknown[];
  readonly selectedStrategy: string | null;
  readonly pools: readonly PoolDetail[];
}

/** One category's pool assignment within a `GET /revisions/:id/session` response (no brackets --
 * that stays the per-category detail's job; this is purely the pool-assignment step). */
export interface SessionCategory {
  readonly category: {
    readonly category_id: string;
    readonly category_key: string;
    readonly stream: string;
    readonly discipline: string;
    readonly format: string;
    readonly gender: string;
    readonly movement: string | null;
  };
  readonly pools: readonly {
    readonly id: string;
    readonly poolUid: string;
    readonly ordinal: number;
    readonly isWalkover: boolean;
    readonly explanation: readonly unknown[];
    readonly members: readonly EntryDisplay[];
    readonly bracket: Bracket | null;
  }[];
}

export interface AuditEvent {
  readonly seq: number;
  readonly id: string;
  readonly occurred_at: string;
  readonly actor_kind: string;
  readonly actor_id: string | null;
  readonly action: string;
  readonly subject_type: string;
  readonly subject_id: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly complaint_id: string | null;
  readonly command_id: string | null;
  readonly hash: string;
  readonly prev_hash: string | null;
}

export interface SearchResult {
  readonly entry_id: string;
  readonly external_ref: string | null;
  readonly contingent: string;
  readonly category_id: string | null;
  readonly category_key: string | null;
}

export type ExportType =
  | 'TOURNAMENT_DRAW_BOOK'
  | 'CATEGORY_DRAW'
  | 'POOL_SHEET'
  | 'BRACKET_SHEET'
  | 'XLSX_WORKBOOK'
  | 'SEMI_PRESTASI_COMPACT_DRAW_SHEET';
export type ExportMode = 'PREVIEW' | 'OFFICIAL';
export type ExportStatus = 'REQUESTED' | 'GENERATING' | 'READY' | 'FAILED';

export interface ExportArtifact {
  readonly id: string;
  readonly tournamentId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly exportType: ExportType;
  readonly format: 'PDF' | 'XLSX';
  readonly mode: ExportMode;
  readonly scopeType: 'REVISION' | 'CATEGORY' | 'POOL';
  readonly categoryId: string | null;
  readonly poolId: string | null;
  readonly status: ExportStatus;
  readonly sourceFingerprint: string;
  readonly parametersFingerprint: string;
  readonly outputFingerprint: string | null;
  readonly fileSha256: string | null;
  readonly filename: string | null;
  readonly sizeBytes: number | null;
  readonly errorCode: string | null;
  readonly requestedAt: string;
  readonly generatedAt: string | null;
}

/** Aggregate pool-quality figures computed by the draw engine (server-side only). */
export interface VerdictMetrics {
  readonly tier0: number;
  readonly tier1Fp: number;
  readonly tier2Fp: number;
  readonly spread: number;
  readonly sizePenaltyFp: number;
  readonly singletons: number;
  readonly ranges: Readonly<Record<string, number>>;
  readonly excess: Readonly<Record<string, number>>;
}
export interface VerdictImpact {
  readonly change: 'IMPROVED' | 'UNCHANGED' | 'WORSE';
  readonly poolUids: readonly string[];
  readonly before: VerdictMetrics;
  readonly after: VerdictMetrics;
}
/** The server's canonical quality verdict of a command (AUD-005); the client never computes one. */
export type CommandVerdict =
  | { readonly level: 'GREEN'; readonly impact?: VerdictImpact }
  | {
      readonly level: 'YELLOW';
      readonly softViolations: readonly string[];
      readonly reasonRequired: true;
      readonly impact?: VerdictImpact;
    }
  | { readonly level: 'RED'; readonly hardViolations: readonly string[]; readonly impact?: VerdictImpact };

export interface CommandOutcome {
  readonly outcome: 'APPLIED' | 'REJECTED';
  readonly rejectionCode: string | null;
  readonly verdict: CommandVerdict;
  readonly resultingRevisionId: string | null;
  readonly commandRowId: string;
  readonly replayed: boolean;
}

// ---------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------

export const api = {
  tournament: (actorId: string, tournamentId: string) =>
    get<TournamentSummary>(`/tournaments/${tournamentId}`, actorId),
  members: (actorId: string, tournamentId: string) =>
    get<TournamentMember[]>(`/tournaments/${tournamentId}/members`, actorId),
  drawRun: (actorId: string, drawRunId: string) => get<DrawRun>(`/draw-runs/${drawRunId}`, actorId),
  drawRunQuality: (actorId: string, drawRunId: string) =>
    get<QualityReport>(`/draw-runs/${drawRunId}/quality`, actorId),
  revision: (actorId: string, revisionId: string) => get<RevisionDetail>(`/revisions/${revisionId}`, actorId),
  categories: (actorId: string, revisionId: string) =>
    get<CategorySummary[]>(`/revisions/${revisionId}/categories`, actorId),
  category: (actorId: string, revisionId: string, categoryId: string) =>
    get<CategoryDetail>(`/revisions/${revisionId}/categories/${categoryId}`, actorId),
  session: (actorId: string, revisionId: string) =>
    get<SessionCategory[]>(`/revisions/${revisionId}/session`, actorId),
  audit: (actorId: string, tournamentId: string, before?: string) =>
    get<{ events: AuditEvent[]; nextCursor: string | null }>(
      `/tournaments/${tournamentId}/audit${before ? `?before=${before}` : ''}`,
      actorId,
    ),
  search: (actorId: string, tournamentId: string, q: string) =>
    get<SearchResult[]>(`/tournaments/${tournamentId}/search?q=${encodeURIComponent(q)}`, actorId),

  tournaments: (actorId: string) => get<TournamentListItem[]>('/tournaments', actorId),
  archiveTournament: (actorId: string, tournamentId: string) =>
    post<{ status: 'ARCHIVED' }>(`/tournaments/${tournamentId}/archive`, actorId, {}),
  entries: (actorId: string, tournamentId: string, params: EntryListParams = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return get<EntryList>(`/tournaments/${tournamentId}/entries${s ? `?${s}` : ''}`, actorId);
  },
  correctEntry: (
    actorId: string,
    tournamentId: string,
    entryId: string,
    body: {
      fullName?: string | null;
      gender?: 'MALE' | 'FEMALE' | null;
      birthDate?: string | null;
      heightMm?: number | null;
      weightG?: number | null;
      beltCode?: string | null;
      declaredAgeDivision?: string | null;
      declaredClass?: string | null;
      contingent?: string | null;
    },
  ) => patch<{ ok: true }>(`/tournaments/${tournamentId}/entries/${entryId}`, actorId, body),
  ruleSetVocabulary: (actorId: string, tournamentId: string) =>
    get<RuleSetVocabulary>(`/tournaments/${tournamentId}/rule-set-vocabulary`, actorId),
  drawPreflight: (actorId: string, tournamentId: string) =>
    get<DrawPreflight>(`/tournaments/${tournamentId}/draw-preflight`, actorId),
  createDrawRun: (actorId: string, tournamentId: string, body: CreateDrawRunBody) =>
    post<CreateDrawRunResult>(`/tournaments/${tournamentId}/draw-runs`, actorId, body),

  moveEntry: (
    actorId: string,
    revisionId: string,
    body: {
      entryId: string;
      toPoolUid: string;
      toSlot: number | null;
      expectedLockVersion: number;
      idempotencyKey: string;
      reason: string | null;
      complaintId: string | null;
    },
  ) => post<CommandOutcome>(`/revisions/${revisionId}/commands/move-entry`, actorId, body),
  swapEntry: (
    actorId: string,
    revisionId: string,
    body: {
      entryA: string;
      entryB: string;
      expectedLockVersion: number;
      idempotencyKey: string;
      reason: string | null;
      complaintId: string | null;
    },
  ) => post<CommandOutcome>(`/revisions/${revisionId}/commands/swap-entry`, actorId, body),
  movePool: (
    actorId: string,
    revisionId: string,
    body: {
      poolUid: string;
      toArenaCode: string;
      toOrder: number;
      expectedLockVersion: number;
      idempotencyKey: string;
      reason: string | null;
      complaintId: string | null;
    },
  ) => post<CommandOutcome>(`/revisions/${revisionId}/commands/move-pool`, actorId, body),

  submitReview: (actorId: string, revisionId: string, expectedLockVersion: number) =>
    post<CommandOutcome>(`/revisions/${revisionId}/submit-review`, actorId, {
      expectedLockVersion,
      idempotencyKey: crypto.randomUUID(),
      reason: null,
      complaintId: null,
    }),
  approve: (actorId: string, revisionId: string, expectedLockVersion: number) =>
    post<CommandOutcome>(`/revisions/${revisionId}/approve`, actorId, {
      expectedLockVersion,
      idempotencyKey: crypto.randomUUID(),
      reason: null,
      complaintId: null,
    }),
  lock: (actorId: string, revisionId: string, expectedLockVersion: number) =>
    post<CommandOutcome>(`/revisions/${revisionId}/lock`, actorId, {
      expectedLockVersion,
      idempotencyKey: crypto.randomUUID(),
      reason: null,
      complaintId: null,
    }),
  publish: (actorId: string, revisionId: string, expectedLockVersion: number) =>
    post<CommandOutcome>(`/revisions/${revisionId}/publish`, actorId, {
      expectedLockVersion,
      idempotencyKey: crypto.randomUUID(),
      reason: null,
      complaintId: null,
    }),
  amend: (actorId: string, revisionId: string, expectedLockVersion: number, reason: string) =>
    post<CommandOutcome>(`/revisions/${revisionId}/amend`, actorId, {
      expectedLockVersion,
      idempotencyKey: crypto.randomUUID(),
      reason,
      complaintId: null,
    }),

  scheduleSlots: (actorId: string, tournamentId: string) =>
    get<ScheduleSlotSummary[]>(`/tournaments/${tournamentId}/schedule`, actorId),
  generateFromSchedule: (
    actorId: string,
    tournamentId: string,
    body: { dayNumber: number; arenaCode: string; seed: string },
  ) =>
    post<{ drawRunId: string; status: 'QUEUED'; matchedCategoryCount: number }>(
      `/tournaments/${tournamentId}/draw-runs/from-schedule`,
      actorId,
      body,
    ),
  setMatchDisplayNo: (
    actorId: string,
    revisionId: string,
    body: {
      matchId: string;
      displayNo: number | null;
      expectedLockVersion: number;
      idempotencyKey: string;
    },
  ) =>
    post<CommandOutcome>(`/revisions/${revisionId}/commands/set-match-display-no`, actorId, {
      ...body,
      reason: null,
      complaintId: null,
    }),

  requestExport: (
    actorId: string,
    revisionId: string,
    body: { exportType: ExportType; mode: ExportMode; categoryId?: string; poolId?: string },
  ) => post<ExportArtifact>(`/revisions/${revisionId}/exports`, actorId, body),
  getExport: (actorId: string, exportId: string) => get<ExportArtifact>(`/exports/${exportId}`, actorId),
  listExports: (actorId: string, revisionId: string) =>
    get<ExportArtifact[]>(`/revisions/${revisionId}/exports`, actorId),
};

export interface ScheduleSlotSummary {
  readonly dayNumber: number;
  readonly date: string;
  readonly arenaCode: string;
  readonly categoryCount: number;
}

export interface SpsUploadResult {
  readonly tournamentId: string;
  readonly actorId: string;
  readonly ruleSetId: string;
  readonly intakeSnapshotId: string;
  readonly participantCount: number;
  readonly scheduleRowCount: number;
  readonly arenaCodes: readonly string[];
  readonly eventStart: string;
  readonly eventEnd: string;
  readonly scheduleIssues: readonly { readonly sheetRow: number; readonly message: string }[];
}

/**
 * Uploads the committee's SPS spreadsheet and bootstraps a brand-new tournament from it (arenas,
 * rule set, arena/day schedule, participant roster) — see apps/api/src/upload/upload.controller.ts.
 * Multipart, so it bypasses the JSON-only `request` helper; the `x-actor-id` header value is
 * whatever the caller has on hand (even a throwaway one) since this endpoint isn't scoped to an
 * existing tournament yet — the response's own `actorId` is the one to use from then on.
 */
export async function uploadSps(actorId: string, file: File): Promise<SpsUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/uploads/sps`, {
    method: 'POST',
    headers: { 'x-actor-id': actorId },
    body: form,
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const b = parsed as { code?: string; message?: string; details?: unknown } | null;
    throw new ApiClientError(
      res.status,
      b?.code ?? 'UNKNOWN_ERROR',
      b?.message ?? res.statusText,
      b?.details,
    );
  }
  return parsed as SpsUploadResult;
}

/** Downloads a READY export's file with the required x-actor-id header (a plain <a href> can't set headers). */
export async function downloadExportFile(actorId: string, exp: ExportArtifact): Promise<void> {
  const res = await fetch(`${API_BASE}/exports/${exp.id}/file`, { headers: { 'x-actor-id': actorId } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiClientError(res.status, body?.code ?? 'UNKNOWN_ERROR', body?.message ?? res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exp.filename ?? 'export';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------------------
// Pre-UAT additions: tournament list (AUD-008), participant inspection (AUD-009), draw generation (AUD-010)
// ---------------------------------------------------------------------------------------

export interface TournamentListItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  readonly eventStart: string;
  readonly eventEnd: string;
  readonly activeRuleSetStatus: string;
  readonly latestDrawRun: TournamentSummary['latestDrawRun'];
  readonly latestRevision: TournamentSummary['latestRevision'];
  readonly categoryCounts: TournamentSummary['categoryCounts'];
}

export interface EntryListParams {
  readonly q?: string;
  readonly contingent?: string;
  readonly discipline?: string;
  readonly format?: string;
  readonly eligibility?: string;
  /** A category id, or 'NONE' for entries without an assigned category. */
  readonly categoryId?: string;
  readonly hasIssues?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntryIssue {
  readonly id: string;
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly status: 'OPEN' | 'ACKNOWLEDGED' | 'OVERRIDDEN' | 'CORRECTED' | 'RESOLVED';
  readonly field: string | null;
  readonly subjectType: string;
}

export interface EntryListItem {
  readonly entryId: string;
  readonly externalRef: string | null;
  readonly contingent: string;
  /** Member names joined with ' / ' (falls back to the external ref). */
  readonly displayName: string;
  readonly format: 'INDIVIDUAL' | 'PAIR' | 'TEAM';
  readonly members: readonly {
    readonly position: number;
    readonly fullName: string | null;
    readonly gender: string | null;
    readonly beltCode: string | null;
    readonly beltLabel: string | null;
    readonly heightMm: number | null;
    readonly weightG: number | null;
    readonly birthDate: string | null;
  }[];
  readonly declared: {
    readonly stream: string;
    readonly discipline: string;
    readonly format: string;
    readonly ageDivision: string;
    readonly weightClass: string | null;
  };
  /** Assigned by a draw run; null until then. `displayName` is the human-readable title, never the raw key. */
  readonly category: { readonly id: string; readonly displayName: string } | null;
  readonly registrationStatus: string;
  readonly eligibilityStatus: 'BLOCKED' | 'READY' | 'OVERRIDDEN' | 'DRAWN';
  readonly eligibilityReasons: readonly string[];
  readonly group: { readonly source: string; readonly status: string; readonly confidence: string } | null;
  readonly issues: readonly EntryIssue[];
  readonly openIssueCounts: { readonly error: number; readonly warning: number; readonly info: number };
}

export interface EntryList {
  readonly items: readonly EntryListItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly facets: { readonly categories: readonly { readonly id: string; readonly displayName: string }[] };
}

/** The active rule set's own belt/age-division/weight-class vocabulary, for the "Perbaiki Data
 * Peserta" dropdowns -- never a hand-invented list, since different rule sets can differ. */
export interface RuleSetVocabulary {
  /** Ordered by rank (Geup 9 lowest through Dan 4 highest). */
  readonly belts: readonly { readonly code: string; readonly rank: number; readonly label: string }[];
  /** Ordered by the rule set's own division order (Pra Cadet A ... Master 4). */
  readonly ageDivisions: readonly { readonly code: string; readonly label: string; readonly order: number }[];
  /** Weight classes are scoped by (stream, ageDivisionCode, gender) -- Kyorugi classes differ by
   * age division and gender, so the Class dropdown filters this by the selected Divisi. */
  readonly weightClassTables: readonly {
    readonly stream: string;
    readonly ageDivisionCode: string;
    readonly gender: string;
    readonly classes: readonly { readonly code: string }[];
  }[];
}

export interface DrawPreflight {
  readonly tournament: { readonly id: string; readonly code: string; readonly name: string };
  readonly role: TournamentMember['role'];
  readonly canRequest: boolean;
  readonly ruleSet: {
    readonly id: string;
    readonly code: string;
    readonly version: number;
    readonly name: string;
    readonly status: string;
  } | null;
  readonly ruleSetLock: {
    readonly lockable: boolean;
    readonly requiresAcknowledgement: boolean;
    readonly blockerCount: number;
    readonly warningCount: number;
    readonly findings: readonly { readonly code: string; readonly level: string; readonly count: number }[];
  } | null;
  readonly intakeSnapshot: {
    readonly id: string;
    readonly entryCount: number;
    readonly createdAt: string;
  } | null;
  readonly entries: { readonly total: number; readonly eligible: number; readonly blocked: number };
  readonly openIssues: { readonly error: number; readonly warning: number; readonly info: number };
  readonly blockers: readonly ('NO_ACTIVE_RULE_SET' | 'NO_INTAKE_SNAPSHOT')[];
}

export interface CreateDrawRunBody {
  readonly ruleSetId: string;
  readonly intakeSnapshotId: string;
  readonly kind: 'CANDIDATE' | 'SIMULATION';
  readonly seed: string;
  /** Category keys to draw; [] = every category (docs/ENGINE_CONTRACT.md). */
  readonly scope: readonly string[];
}

export interface CreateDrawRunResult {
  readonly drawRunId: string;
  readonly inputFingerprint: string;
  readonly status: 'QUEUED';
}
