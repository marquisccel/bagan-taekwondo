import type { ComplaintStatus } from './enums.js';

/**
 * Complaint lifecycle. An ACCEPTED or RESOLVED complaint must reference the draw command or
 * revision that implemented it, so the audit trail can answer "what changed because of this
 * complaint". The database enforces the same rule with a CHECK constraint.
 */
const COMPLAINT_TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  OPEN: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['RESOLVED'],
  REJECTED: [],
  RESOLVED: [],
};

export function canChangeComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return COMPLAINT_TRANSITIONS[from].includes(to);
}

export interface ComplaintResolutionRefs {
  readonly resultingCommandId: string | null;
  readonly resultingRevisionId: string | null;
  readonly decision: string | null;
}

export function complaintRefsValid(status: ComplaintStatus, refs: ComplaintResolutionRefs): boolean {
  const hasDecision = refs.decision !== null && refs.decision.trim().length > 0;
  const hasRef = refs.resultingCommandId !== null || refs.resultingRevisionId !== null;
  switch (status) {
    case 'OPEN':
    case 'UNDER_REVIEW':
      return true;
    case 'REJECTED':
      return hasDecision;
    case 'ACCEPTED':
    case 'RESOLVED':
      return hasDecision && hasRef;
  }
}
