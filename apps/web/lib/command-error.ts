import { ApiClientError, type CommandOutcome, type CommandVerdict } from './api';
import { describeImpactCodes } from './impact-labels';

/**
 * A command result, from the caller's point of view: either applied, or rejected with a code and
 * a human-readable message. The backend's command endpoints (apps/api/src/revision/revision.controller.ts)
 * map every REJECTED `CommandOutcome` onto a non-2xx HTTP status (`ApiError`), so a rejection
 * always reaches the client as a thrown `ApiClientError`, never as a resolved `{outcome:'REJECTED'}`
 * body — this normalizes both shapes into one so callers only need one branch.
 */
export type CommandResult =
  | { readonly ok: true; readonly outcome: CommandOutcome }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      /** The server's verdict, when the refusal carries one (RED hard violation, YELLOW reason required). */
      readonly verdict?: CommandVerdict;
    };

function verdictOf(details: unknown): CommandVerdict | undefined {
  const v = (details as { verdict?: CommandVerdict } | null | undefined)?.verdict;
  return v && typeof v === 'object' && 'level' in v ? v : undefined;
}

export async function runCommand(fn: () => Promise<CommandOutcome>): Promise<CommandResult> {
  try {
    const outcome = await fn();
    if (outcome.outcome === 'REJECTED' && outcome.rejectionCode) {
      const message =
        outcome.verdict.level === 'RED' ? outcome.verdict.hardViolations.join('; ') : outcome.rejectionCode;
      return { ok: false, code: outcome.rejectionCode, message, verdict: outcome.verdict };
    }
    return { ok: true, outcome };
  } catch (e: unknown) {
    if (e instanceof ApiClientError)
      return { ok: false, code: e.code, message: e.message, verdict: verdictOf(e.details) };
    return { ok: false, code: 'UNKNOWN_ERROR', message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/** A safe, operator-facing message for a rejection code — never the raw backend text for these. */
export function friendlyMessage(code: string, fallback: string): string {
  if (code === 'FORBIDDEN_COMMAND' || code === 'UNAUTHORIZED_TOURNAMENT_ACCESS')
    return 'You do not have permission to do this.';
  if (code === 'REVISION_LOCKED')
    return 'This revision is no longer editable (locked, published, or amended).';
  if (code === 'RULE_SET_NOT_READY') return fallback;
  return fallback;
}

/**
 * Indonesian, operator-facing text for a refused MoveEntry / SwapEntries (AUD-005 / AUD-007). The
 * machine-readable reasons come from the server's verdict; only the wording lives here.
 */
export function friendlyCommandRefusal(result: {
  code: string;
  message: string;
  verdict?: CommandVerdict;
}): string | null {
  switch (result.code) {
    case 'HARD_CONSTRAINT_VIOLATED': {
      const codes = result.verdict?.level === 'RED' ? result.verdict.hardViolations : [];
      return `Perubahan ditolak karena melanggar aturan wajib: ${describeImpactCodes(codes)}. Drawing tidak diubah.`;
    }
    case 'BRACKET_INVARIANT_VIOLATED':
      return 'Perubahan ditolak: susunan bagan yang dihasilkan tidak valid. Drawing tidak diubah. Hubungi administrator jika berulang.';
    case 'REASON_REQUIRED':
      return 'Perubahan ini menurunkan kualitas pengelompokan. Isi alasan untuk melanjutkan.';
    case 'ENTRY_NOT_FOUND':
      return 'Peserta tidak ditemukan pada revisi ini.';
    case 'POOL_NOT_FOUND':
      return 'Pool tujuan tidak ditemukan pada revisi ini.';
    default:
      return null;
  }
}

/** Indonesian operator-facing messages for the Phase 6 export UI specifically. */
export function friendlyExportMessage(code: string, fallback: string): string {
  switch (code) {
    case 'EXPORT_UNAUTHORIZED':
      return 'Anda tidak memiliki izin untuk membuat ekspor ini.';
    case 'EXPORT_REVISION_NOT_ALLOWED':
      return 'Status revisi saat ini tidak mengizinkan ekspor jenis ini.';
    case 'EXPORT_SOURCE_NOT_FOUND':
      return 'Data sumber untuk ekspor ini tidak ditemukan.';
    case 'EXPORT_NOT_READY':
      return 'Berkas belum siap diunduh.';
    case 'EXPORT_GENERATION_FAILED':
    case 'EXPORT_TEMPLATE_ERROR':
      return 'Pembuatan berkas gagal. Coba lagi.';
    case 'EXPORT_TOO_LARGE':
      return 'Berkas ekspor terlalu besar.';
    case 'VALIDATION_ERROR':
      return fallback;
    default:
      return fallback;
  }
}
