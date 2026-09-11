import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { REGISTRATION_STATUSES, REVISION_LIFECYCLES, type RevisionLifecycle } from './enums.js';
import {
  canChangeRegistration,
  deriveEligibility,
  isPlaceable,
  isRegistrationTerminal,
  type EligibilityInputs,
} from './participant-status.js';
import {
  acceptsDrawCommands,
  isContentFrozen,
  nextLifecycle,
  REVISION_ACTIONS,
  type RevisionAction,
} from './revision-lifecycle.js';

describe('revision lifecycle', () => {
  const walk = (actions: readonly RevisionAction[]) => {
    const states: RevisionLifecycle[] = ['DRAFT'];
    for (const a of actions) {
      const next = nextLifecycle(states[states.length - 1] ?? 'DRAFT', a);
      if (next !== undefined) states.push(next);
    }
    return states;
  };

  it('PUBLISHED is only ever entered from LOCKED or by abandoning an amendment', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...REVISION_ACTIONS), { maxLength: 40 }), (actions) => {
        const states = walk(actions);
        states.forEach((s, i) => {
          if (s === 'PUBLISHED' && i > 0) expect(['LOCKED', 'AMENDED']).toContain(states[i - 1]);
        });
      }),
    );
  });

  it('once content is frozen it never becomes editable again', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...REVISION_ACTIONS), { maxLength: 40 }), (actions) => {
        const states = walk(actions);
        const firstFrozen = states.findIndex(isContentFrozen);
        if (firstFrozen >= 0) {
          expect(states.slice(firstFrozen).every(isContentFrozen)).toBe(true);
        }
      }),
    );
  });

  it('only DRAFT accepts draw commands and SUPERSEDED is terminal', () => {
    for (const s of REVISION_LIFECYCLES) {
      expect(acceptsDrawCommands(s)).toBe(s === 'DRAFT');
    }
    for (const a of REVISION_ACTIONS) {
      expect(nextLifecycle('SUPERSEDED', a)).toBeUndefined();
    }
  });
});

describe('registration and eligibility', () => {
  it('terminal registration states have no outgoing transitions', () => {
    for (const from of REGISTRATION_STATUSES) {
      for (const to of REGISTRATION_STATUSES) {
        if (isRegistrationTerminal(from)) expect(canChangeRegistration(from, to)).toBe(false);
      }
    }
  });

  const inputs: fc.Arbitrary<EligibilityInputs> = fc.record({
    registration: fc.constantFrom(...REGISTRATION_STATUSES),
    openBlockingIssues: fc.nat(3),
    overriddenIssues: fc.nat(3),
    ruleGaps: fc.nat(2),
    entryGroupFinal: fc.boolean(),
    inLockedRevision: fc.boolean(),
  });

  it('an entry is placeable only when nothing blocks it', () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const placeable = isPlaceable(deriveEligibility(i));
        const blocked =
          isRegistrationTerminal(i.registration) ||
          i.openBlockingIssues > 0 ||
          i.ruleGaps > 0 ||
          !i.entryGroupFinal;
        expect(placeable).toBe(!blocked);
      }),
    );
  });

  it('overrides are visible: an entry that relies on an override is OVERRIDDEN, never READY', () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const e = deriveEligibility(i);
        if (e === 'READY') expect(i.overriddenIssues).toBe(0);
      }),
    );
  });

  it('VERIFIED registration does not by itself make an entry eligible', () => {
    expect(
      deriveEligibility({
        registration: 'VERIFIED',
        openBlockingIssues: 0,
        overriddenIssues: 0,
        ruleGaps: 1,
        entryGroupFinal: true,
        inLockedRevision: false,
      }),
    ).toBe('BLOCKED');
  });
});
