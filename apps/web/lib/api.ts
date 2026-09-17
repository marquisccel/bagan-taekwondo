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
    const b = body as { code?: string; message?: string } | null;
    throw new ApiClientError(res.status, b?.code ?? 'UNKNOWN_ERROR', b?.message ?? res.statusText);
  }
  return body as T;
}

const get = <T>(path: string, actorId: string) => request<T>(path, actorId);
const post = <T>(path: string, actorId: string, body: unknown) =>
  request<T>(path, actorId, { method: 'POST', body: JSON.stringify(body) });

// ---------------------------------------------------------------------------------------
// Response shapes (subset of the backend's actual columns — see apps/api/src/**/*.controller.ts)
// ---------------------------------------------------------------------------------------

export interface TournamentSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
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

export interface CommandOutcome {
  readonly outcome: 'APPLIED' | 'REJECTED';
  readonly rejectionCode: string | null;
  readonly verdict:
    | { readonly level: 'GREEN' }
    | { readonly level: 'YELLOW'; readonly softViolations: readonly string[]; readonly reasonRequired: true }
    | { readonly level: 'RED'; readonly hardViolations: readonly string[] };
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
  audit: (actorId: string, tournamentId: string, before?: string) =>
    get<{ events: AuditEvent[]; nextCursor: string | null }>(
      `/tournaments/${tournamentId}/audit${before ? `?before=${before}` : ''}`,
      actorId,
    ),
  search: (actorId: string, tournamentId: string, q: string) =>
    get<SearchResult[]>(`/tournaments/${tournamentId}/search?q=${encodeURIComponent(q)}`, actorId),

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
};
