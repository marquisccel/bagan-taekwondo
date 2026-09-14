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
};

export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super({ code, message: message ?? code }, API_ERROR_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
