import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The stable error taxonomy (Phase 4 spec §15). Every non-2xx response body is
 * `{ code, message }` — never a stack trace. `CommandErrorCode` values from
 * `@bagantkd/db` (command-repository.ts) are additionally accepted so a REJECTED
 * `CommandOutcome` maps through the same table without duplicating the list.
 */
export const API_ERROR_STATUS: Readonly<Record<string, HttpStatus>> = {
  REVISION_CONFLICT: HttpStatus.CONFLICT,
  REVISION_LOCKED: HttpStatus.CONFLICT,
  UNAUTHORIZED_TOURNAMENT_ACCESS: HttpStatus.FORBIDDEN,
  FORBIDDEN_COMMAND: HttpStatus.FORBIDDEN,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  DRAW_RUN_NOT_READY: HttpStatus.CONFLICT,
  DRAW_RUN_UNSAFE: HttpStatus.CONFLICT,
  DRAW_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_COMMAND: HttpStatus.BAD_REQUEST,
  RULE_SET_NOT_READY: HttpStatus.CONFLICT,
  REVISION_NOT_FOUND: HttpStatus.NOT_FOUND,
  ENTRY_NOT_FOUND: HttpStatus.NOT_FOUND,
  POOL_NOT_FOUND: HttpStatus.NOT_FOUND,
  TOURNAMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  // Post-draw quality (AUD-005) and clean bracket-invariant rejection (AUD-007): the command was
  // understood but refused (nothing changed), or needs an operator reason first.
  HARD_CONSTRAINT_VIOLATED: HttpStatus.UNPROCESSABLE_ENTITY,
  REASON_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  BRACKET_INVARIANT_VIOLATED: HttpStatus.UNPROCESSABLE_ENTITY,
  // Phase 6 — exports.
  EXPORT_SOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXPORT_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXPORT_REVISION_NOT_ALLOWED: HttpStatus.CONFLICT,
  EXPORT_ALREADY_EXISTS: HttpStatus.CONFLICT,
  EXPORT_NOT_READY: HttpStatus.CONFLICT,
  EXPORT_GENERATION_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  EXPORT_TEMPLATE_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  EXPORT_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  EXPORT_UNAUTHORIZED: HttpStatus.FORBIDDEN,
};

export class ApiError extends HttpException {
  /** `details` is optional structured, machine-readable context (e.g. a command verdict); never a stack. */
  constructor(
    readonly code: string,
    message?: string,
    details?: unknown,
  ) {
    super(
      { code, message: message ?? code, ...(details === undefined ? {} : { details }) },
      API_ERROR_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
