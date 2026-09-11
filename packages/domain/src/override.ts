import { err, ok, type Result } from '@bagantkd/shared';

import type { IssueSeverity, IssueStatus, Role } from './enums.js';
import { ISSUE_CATALOG, OVERRIDE_REASON_MIN_LENGTH, OVERRIDE_ROLES, type IssueCode } from './issues.js';

/**
 * An explicit, attributable acceptance of a data-quality ERROR by a Technical Delegate
 * (ADR-0011). Overrides are never implicit: no code path may treat an issue as overridden
 * without an OverrideRecord, and every record produces an audit event.
 */
export interface OverrideRequest {
  readonly issue: {
    readonly code: IssueCode;
    readonly severity: IssueSeverity;
    readonly status: IssueStatus;
  };
  readonly actorRoles: readonly Role[];
  readonly reason: string;
}

export type OverrideRejection =
  | 'OVERRIDE_NOT_PERMITTED_FOR_ROLE'
  | 'OVERRIDE_NOT_ALLOWED_FOR_CODE'
  | 'OVERRIDE_ONLY_FOR_ERRORS'
  | 'OVERRIDE_ISSUE_NOT_OPEN'
  | 'OVERRIDE_REASON_TOO_SHORT';

export function validateOverride(req: OverrideRequest): Result<true, OverrideRejection> {
  if (!req.actorRoles.some((r) => OVERRIDE_ROLES.includes(r))) return err('OVERRIDE_NOT_PERMITTED_FOR_ROLE');
  if (req.issue.severity !== 'ERROR') return err('OVERRIDE_ONLY_FOR_ERRORS');
  if (!ISSUE_CATALOG[req.issue.code].overridable) return err('OVERRIDE_NOT_ALLOWED_FOR_CODE');
  if (req.issue.status !== 'OPEN') return err('OVERRIDE_ISSUE_NOT_OPEN');
  if (req.reason.trim().length < OVERRIDE_REASON_MIN_LENGTH) return err('OVERRIDE_REASON_TOO_SHORT');
  return ok(true);
}
