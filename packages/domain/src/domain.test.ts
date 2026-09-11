import { describe, expect, it } from 'vitest';

import { canChangeComplaint, complaintRefsValid } from './complaint.js';
import { checkComposition, DEFAULT_COMPOSITION, isEntryGroupFinal } from './entry-group.js';
import { ISSUE_CATALOG, ISSUE_CODES } from './issues.js';
import { validateOverride } from './override.js';
import { formatHeightCm, formatWeightKg, heightMmFromCm, weightGFromKg } from './units.js';

describe('units', () => {
  it.each([
    ['170.00', 1700],
    ['161', 1610],
    ['0.00', 0],
    ['734.00', 7340],
    ['145,5', 1455],
  ])('parses height %s cm to %i mm without floating point', (raw, mm) => {
    expect(heightMmFromCm(raw)).toBe(mm);
  });

  it.each([
    ['58.00', 58_000],
    ['58.3', 58_300],
    ['0.125', 125],
  ])('parses weight %s kg to %i g', (raw, g) => {
    expect(weightGFromKg(raw)).toBe(g);
  });

  it.each(['', 'abc', '-1', '1.2.3', '12.34'])('rejects height %j', (raw) => {
    expect(() => heightMmFromCm(raw)).toThrowError();
  });

  it('formats for operators', () => {
    expect(formatHeightCm(heightMmFromCm('145.5'))).toBe('145.5 cm');
    expect(formatWeightKg(weightGFromKg('58.30'))).toBe('58.3 kg');
  });
});

describe('entry groups', () => {
  const pair = DEFAULT_COMPOSITION.find((c) => c.format === 'PAIR');
  const team = DEFAULT_COMPOSITION.find((c) => c.format === 'TEAM');

  it('a heuristic group is never final without a confirming person', () => {
    expect(
      isEntryGroupFinal({ source: 'HEURISTIC', status: 'PROPOSED', confidence: 'HIGH', confirmedBy: null }),
    ).toBe(false);
    expect(
      isEntryGroupFinal({ source: 'HEURISTIC', status: 'CONFIRMED', confidence: 'HIGH', confirmedBy: null }),
    ).toBe(false);
    expect(
      isEntryGroupFinal({ source: 'HEURISTIC', status: 'CONFIRMED', confidence: 'HIGH', confirmedBy: 'u1' }),
    ).toBe(true);
    expect(
      isEntryGroupFinal({ source: 'EXPLICIT', status: 'CONFIRMED', confidence: 'HIGH', confirmedBy: null }),
    ).toBe(true);
    expect(
      isEntryGroupFinal({ source: 'EXPLICIT', status: 'REJECTED', confidence: 'HIGH', confirmedBy: null }),
    ).toBe(false);
  });

  it('pair requires exactly one male and one female', () => {
    expect(pair).toBeDefined();
    if (!pair) return;
    expect(
      checkComposition(pair, [
        { athleteId: 'a', gender: 'MALE' },
        { athleteId: 'b', gender: 'FEMALE' },
      ]),
    ).toEqual([]);
    expect(
      checkComposition(pair, [
        { athleteId: 'a', gender: 'FEMALE' },
        { athleteId: 'b', gender: 'FEMALE' },
      ]),
    ).toEqual(['WRONG_GENDER_COMPOSITION']);
    expect(
      checkComposition(pair, [
        { athleteId: 'a', gender: 'MALE' },
        { athleteId: 'a', gender: 'FEMALE' },
      ]),
    ).toContain('DUPLICATE_MEMBER');
  });

  it('team requires three members of one gender', () => {
    expect(team).toBeDefined();
    if (!team) return;
    const m = (id: string, gender: 'MALE' | 'FEMALE') => ({ athleteId: id, gender });
    expect(checkComposition(team, [m('a', 'FEMALE'), m('b', 'FEMALE'), m('c', 'FEMALE')])).toEqual([]);
    expect(checkComposition(team, [m('a', 'FEMALE'), m('b', 'MALE'), m('c', 'FEMALE')])).toEqual([
      'WRONG_GENDER_COMPOSITION',
    ]);
    expect(checkComposition(team, [m('a', 'FEMALE'), m('b', 'FEMALE')])).toEqual(['WRONG_SIZE']);
  });
});

describe('data-quality overrides', () => {
  const issue = { code: 'HEIGHT_OUT_OF_RANGE', severity: 'ERROR', status: 'OPEN' } as const;
  const reason = 'Height re-measured at venue: 134 cm; registration typo 734.';

  it('accepts an overridable ERROR by a Technical Delegate with a reason', () => {
    expect(validateOverride({ issue, actorRoles: ['TECHNICAL_DELEGATE'], reason })).toEqual({
      ok: true,
      value: true,
    });
  });

  it.each([
    [{ issue, actorRoles: ['DRAWING_OFFICER'], reason }, 'OVERRIDE_NOT_PERMITTED_FOR_ROLE'],
    [
      { issue: { ...issue, code: 'UNKNOWN_CLASS' }, actorRoles: ['TECHNICAL_DELEGATE'], reason },
      'OVERRIDE_NOT_ALLOWED_FOR_CODE',
    ],
    [
      { issue: { ...issue, severity: 'WARNING' }, actorRoles: ['TECHNICAL_DELEGATE'], reason },
      'OVERRIDE_ONLY_FOR_ERRORS',
    ],
    [
      { issue: { ...issue, status: 'OVERRIDDEN' }, actorRoles: ['TECHNICAL_DELEGATE'], reason },
      'OVERRIDE_ISSUE_NOT_OPEN',
    ],
    [{ issue, actorRoles: ['TECHNICAL_DELEGATE'], reason: 'ok' }, 'OVERRIDE_REASON_TOO_SHORT'],
  ] as const)('rejects %#', (req, code) => {
    expect(validateOverride(req)).toEqual({ ok: false, error: code });
  });

  it('never allows overriding issues that would make the draw structurally unsafe', () => {
    for (const code of [
      'UNKNOWN_CLASS',
      'UNKNOWN_BELT',
      'ENTRY_GROUP_AMBIGUOUS',
      'ENTRY_GROUP_UNCONFIRMED',
      'HEIGHT_MISSING',
    ] as const) {
      expect(ISSUE_CATALOG[code].overridable).toBe(false);
    }
  });

  it('catalog covers every declared code', () => {
    expect(Object.keys(ISSUE_CATALOG).sort()).toEqual([...ISSUE_CODES].sort());
  });
});

describe('complaints', () => {
  it('ACCEPTED and RESOLVED must reference the resulting command or revision', () => {
    expect(
      complaintRefsValid('ACCEPTED', {
        decision: 'Moved to pool P-3',
        resultingCommandId: null,
        resultingRevisionId: null,
      }),
    ).toBe(false);
    expect(
      complaintRefsValid('ACCEPTED', {
        decision: 'Moved to pool P-3',
        resultingCommandId: 'c1',
        resultingRevisionId: null,
      }),
    ).toBe(true);
    expect(
      complaintRefsValid('REJECTED', { decision: '', resultingCommandId: null, resultingRevisionId: null }),
    ).toBe(false);
  });

  it('terminal statuses have no transitions', () => {
    expect(canChangeComplaint('REJECTED', 'OPEN')).toBe(false);
    expect(canChangeComplaint('RESOLVED', 'ACCEPTED')).toBe(false);
    expect(canChangeComplaint('UNDER_REVIEW', 'ACCEPTED')).toBe(true);
  });
});
