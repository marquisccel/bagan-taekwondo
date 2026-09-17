import { describe, expect, it } from 'vitest';

import { ApiClientError } from './api';
import { friendlyMessage, runCommand } from './command-error';

describe('runCommand', () => {
  it('is ok when the command applies', async () => {
    const result = await runCommand(() =>
      Promise.resolve({
        outcome: 'APPLIED',
        rejectionCode: null,
        verdict: { level: 'GREEN' },
        resultingRevisionId: null,
        commandRowId: 'c1',
        replayed: false,
      }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('normalizes a REAL rejection thrown as an HTTP error (apps/api always throws for REJECTED — see revision.controller.ts)', async () => {
    const result = await runCommand(() => {
      throw new ApiClientError(409, 'REVISION_CONFLICT', 'expected lock_version 0, current is different');
    });
    expect(result).toEqual({
      ok: false,
      code: 'REVISION_CONFLICT',
      message: 'expected lock_version 0, current is different',
    });
  });

  it('also handles a resolved {outcome: REJECTED} body, in case that ever becomes reachable', async () => {
    const result = await runCommand(() =>
      Promise.resolve({
        outcome: 'REJECTED',
        rejectionCode: 'FORBIDDEN_COMMAND',
        verdict: { level: 'RED', hardViolations: ['role too low'] },
        resultingRevisionId: null,
        commandRowId: 'c1',
        replayed: false,
      }),
    );
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN_COMMAND', message: 'role too low' });
  });

  it('falls back to UNKNOWN_ERROR for a non-ApiClientError failure (e.g. a network drop)', async () => {
    const result = await runCommand(() => {
      throw new Error('fetch failed');
    });
    expect(result).toEqual({ ok: false, code: 'UNKNOWN_ERROR', message: 'fetch failed' });
  });
});

describe('friendlyMessage', () => {
  it('never surfaces the raw backend text for forbidden/unauthorized — always the same safe copy', () => {
    expect(friendlyMessage('FORBIDDEN_COMMAND', 'role DRAWING_OFFICER may not issue LOCK')).toBe(
      'You do not have permission to do this.',
    );
    expect(friendlyMessage('UNAUTHORIZED_TOURNAMENT_ACCESS', 'caller is not a member')).toBe(
      'You do not have permission to do this.',
    );
  });

  it('gives a specific explanation for a locked/frozen revision', () => {
    expect(friendlyMessage('REVISION_LOCKED', 'revision is LOCKED, not DRAFT')).toMatch(/no longer editable/);
  });

  it('passes through the backend message for other codes (e.g. RULE_SET_NOT_READY reasons)', () => {
    expect(friendlyMessage('RULE_SET_NOT_READY', 'MAX_TOLERANCE_UNSET; RULE_SET_NOT_ACTIVE')).toBe(
      'MAX_TOLERANCE_UNSET; RULE_SET_NOT_ACTIVE',
    );
  });
});
