import { describe, expect, it } from 'vitest';

import { canAttempt, isDraft, nextLifecycleAction } from './lifecycle';

describe('nextLifecycleAction', () => {
  it('maps each lifecycle state to its single next action, matching packages/domain revision-lifecycle.ts', () => {
    expect(nextLifecycleAction('DRAFT')).toMatchObject({
      action: 'submit-review',
      minRole: 'DRAWING_OFFICER',
    });
    expect(nextLifecycleAction('REVIEW')).toMatchObject({ action: 'approve', minRole: 'TECHNICAL_DELEGATE' });
    expect(nextLifecycleAction('APPROVED')).toMatchObject({ action: 'lock', minRole: 'TECHNICAL_DELEGATE' });
    expect(nextLifecycleAction('LOCKED')).toMatchObject({ action: 'publish', minRole: 'TECHNICAL_DELEGATE' });
    expect(nextLifecycleAction('PUBLISHED')).toMatchObject({
      action: 'amend',
      minRole: 'TECHNICAL_DELEGATE',
    });
  });

  it('has no next action for terminal-for-the-UI states', () => {
    expect(nextLifecycleAction('AMENDED')).toBeNull();
    expect(nextLifecycleAction('SUPERSEDED')).toBeNull();
    expect(nextLifecycleAction('unknown')).toBeNull();
  });
});

describe('canAttempt', () => {
  const publishAction = nextLifecycleAction('LOCKED')!;

  it('is false for a null (unrecognized) actor', () => {
    expect(canAttempt(null, publishAction)).toBe(false);
  });

  it('is false below the required rank and true at/above it', () => {
    expect(canAttempt('DRAWING_OFFICER', publishAction)).toBe(false);
    expect(canAttempt('TECHNICAL_DELEGATE', publishAction)).toBe(true);
    expect(canAttempt('ADMIN', publishAction)).toBe(true);
  });
});

describe('isDraft', () => {
  it('is true only for DRAFT — content commands only apply there', () => {
    expect(isDraft('DRAFT')).toBe(true);
    expect(isDraft('REVIEW')).toBe(false);
    expect(isDraft('LOCKED')).toBe(false);
  });
});
