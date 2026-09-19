import { describe, expect, it } from 'vitest';

import { ApiClientError } from './api';
import { friendlyCommandRefusal, friendlyMessage, runCommand } from './command-error';

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
    expect(result).toEqual({
      ok: false,
      code: 'FORBIDDEN_COMMAND',
      message: 'role too low',
      verdict: { level: 'RED', hardViolations: ['role too low'] },
    });
  });

  it('falls back to UNKNOWN_ERROR for a non-ApiClientError failure (e.g. a network drop)', async () => {
    const result = await runCommand(() => {
      throw new Error('fetch failed');
    });
    expect(result).toEqual({ ok: false, code: 'UNKNOWN_ERROR', message: 'fetch failed' });
  });
});

describe('runCommand — server verdict on a refusal (AUD-005)', () => {
  it('carries the verdict of a REASON_REQUIRED refusal so the UI can ask for a reason', async () => {
    const verdict = {
      level: 'YELLOW',
      softViolations: ['WEIGHT_TOLERANCE_WORSENED'],
      reasonRequired: true,
    };
    const result = await runCommand(() => {
      throw new ApiClientError(422, 'REASON_REQUIRED', 'REASON_REQUIRED', { verdict });
    });
    expect(result).toEqual({ ok: false, code: 'REASON_REQUIRED', message: 'REASON_REQUIRED', verdict });
  });

  it('a refusal without details has no verdict', async () => {
    const result = await runCommand(() => {
      throw new ApiClientError(409, 'REVISION_CONFLICT', 'stale');
    });
    expect(result).toMatchObject({ ok: false, verdict: undefined });
  });
});

describe('friendlyCommandRefusal (Indonesian)', () => {
  it('explains a hard violation with the server reason codes and says nothing changed', () => {
    const text = friendlyCommandRefusal({
      code: 'HARD_CONSTRAINT_VIOLATED',
      message: 'POOL_SIZE_EXCEEDED',
      verdict: { level: 'RED', hardViolations: ['POOL_SIZE_EXCEEDED'] },
    });
    expect(text).toContain('melanggar aturan wajib');
    expect(text).toContain('melebihi batas maksimum');
    expect(text).toContain('Drawing tidak diubah');
  });

  it('explains a bracket invariant failure without leaking internals', () => {
    const text = friendlyCommandRefusal({
      code: 'BRACKET_INVARIANT_VIOLATED',
      message: 'FORCED_INVARIANT',
    });
    expect(text).toContain('susunan bagan');
    expect(text).not.toContain('FORCED_INVARIANT');
  });

  it('returns null for codes it does not own', () => {
    expect(friendlyCommandRefusal({ code: 'REVISION_LOCKED', message: 'x' })).toBeNull();
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
