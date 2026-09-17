import { describe, expect, it } from 'vitest';

import { buildExportModel, type BuildExportModelArgs, type RawEntryRow } from './model.js';

const entry = (id: string, name: string): RawEntryRow => ({
  id,
  externalRef: id,
  displayName: name,
  contingent: 'DKI Jakarta',
  athletes: [{ fullName: name, gender: 'MALE', weightG: 60000, heightMm: 1700, beltCode: 'HITAM' }],
});

const baseArgs = (overrides: Partial<BuildExportModelArgs> = {}): BuildExportModelArgs => ({
  tournament: { id: 't1', code: 'T1', name: 'Piala Uji', eventStart: '2026-08-27', eventEnd: '2026-08-30' },
  revision: {
    id: 'r1',
    revisionNo: 1,
    lifecycle: 'DRAFT',
    contentFingerprint: 'sha256:abc',
    submittedAt: null,
    approvedAt: null,
    lockedAt: null,
    publishedAt: null,
  },
  quality: null,
  categories: [],
  pools: [],
  poolMembers: [],
  entries: [],
  brackets: [],
  bracketSlots: [],
  matches: [],
  ...overrides,
});

describe('buildExportModel — determinism and exact mapping', () => {
  it('orders categories by categoryKey regardless of input order', () => {
    const model = buildExportModel(
      baseArgs({
        categories: [
          {
            id: 'c2',
            categoryKey: 'B',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
          {
            id: 'c1',
            categoryKey: 'A',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
        ],
      }),
    );
    expect(model.categories.map((c) => c.categoryKey)).toEqual(['A', 'B']);
  });

  it('orders pools by ordinal and bracket slots by position, independent of insertion order', () => {
    const model = buildExportModel(
      baseArgs({
        categories: [
          {
            id: 'c1',
            categoryKey: 'A',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
        ],
        pools: [
          { id: 'p2', categoryId: 'c1', poolUid: 'A-2', ordinal: 2, isWalkover: false, warnings: [] },
          { id: 'p1', categoryId: 'c1', poolUid: 'A-1', ordinal: 1, isWalkover: false, warnings: [] },
        ],
        entries: [entry('e1', 'Budi'), entry('e2', 'Ani')],
        brackets: [{ id: 'b1', poolId: 'p1', size: 2, rounds: 1, entries: 2, byes: 0 }],
        bracketSlots: [
          { bracketId: 'b1', position: 1, seedNo: null, entryId: 'e1' },
          { bracketId: 'b1', position: 0, seedNo: null, entryId: 'e2' },
        ],
      }),
    );
    expect(model.categories[0]?.pools.map((p) => p.poolUid)).toEqual(['A-1', 'A-2']);
    const slots = model.categories[0]?.pools[0]?.bracket?.slots ?? [];
    expect(slots.map((s) => s.position)).toEqual([0, 1]);
    expect(slots.map((s) => s.entry?.displayName)).toEqual(['Ani', 'Budi']);
  });

  it('marks a slot with no entry as BYE, never inventing a participant', () => {
    const model = buildExportModel(
      baseArgs({
        categories: [
          {
            id: 'c1',
            categoryKey: 'A',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
        ],
        pools: [{ id: 'p1', categoryId: 'c1', poolUid: 'A-1', ordinal: 1, isWalkover: false, warnings: [] }],
        entries: [entry('e1', 'Budi')],
        brackets: [{ id: 'b1', poolId: 'p1', size: 2, rounds: 1, entries: 1, byes: 1 }],
        bracketSlots: [
          { bracketId: 'b1', position: 0, seedNo: 1, entryId: 'e1' },
          { bracketId: 'b1', position: 1, seedNo: null, entryId: null },
        ],
      }),
    );
    const slots = model.categories[0]?.pools[0]?.bracket?.slots ?? [];
    expect(slots[1]).toMatchObject({ isBye: true, entry: null });
  });

  it('resolves a match feeder to the previous match public code, never a raw internal id', () => {
    const model = buildExportModel(
      baseArgs({
        categories: [
          {
            id: 'c1',
            categoryKey: 'A',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
        ],
        pools: [{ id: 'p1', categoryId: 'c1', poolUid: 'A-1', ordinal: 1, isWalkover: false, warnings: [] }],
        brackets: [{ id: 'b1', poolId: 'p1', size: 4, rounds: 2, entries: 4, byes: 0 }],
        matches: [
          {
            id: 'm2',
            bracketId: 'b1',
            matchUid: 'm2',
            publicCode: 'A-1-R1-2',
            round: 1,
            position: 2,
            status: 'PENDING',
            feederASlot: 2,
            feederAMatchId: null,
            feederBSlot: 3,
            feederBMatchId: null,
          },
          {
            id: 'm1',
            bracketId: 'b1',
            matchUid: 'm1',
            publicCode: 'A-1-R1-1',
            round: 1,
            position: 1,
            status: 'PENDING',
            feederASlot: 0,
            feederAMatchId: null,
            feederBSlot: 1,
            feederBMatchId: null,
          },
          {
            id: 'mF',
            bracketId: 'b1',
            matchUid: 'mF',
            publicCode: 'A-1-R2-1',
            round: 2,
            position: 1,
            status: 'PENDING',
            feederASlot: null,
            feederAMatchId: 'm1',
            feederBSlot: null,
            feederBMatchId: 'm2',
          },
        ],
      }),
    );
    const matches = model.categories[0]?.pools[0]?.bracket?.matches ?? [];
    expect(matches.map((m) => m.publicCode)).toEqual(['A-1-R1-1', 'A-1-R1-2', 'A-1-R2-1']);
    const final = matches.find((m) => m.matchUid === 'mF');
    expect(final?.feederA).toEqual({ kind: 'match', publicCode: 'A-1-R1-1' });
    expect(final?.feederB).toEqual({ kind: 'match', publicCode: 'A-1-R1-2' });
  });

  it('is a pure function: identical input always produces a deeply equal model', () => {
    const args = baseArgs({
      categories: [
        {
          id: 'c1',
          categoryKey: 'A',
          stream: 'S',
          discipline: 'KYORUGI',
          format: 'INDIVIDUAL',
          gender: 'MALE',
          movement: null,
          ageDivisionCode: null,
          weightClassCode: null,
          readiness: 'READY',
        },
      ],
      pools: [{ id: 'p1', categoryId: 'c1', poolUid: 'A-1', ordinal: 1, isWalkover: false, warnings: ['w'] }],
      entries: [entry('e1', 'Budi')],
      poolMembers: [{ poolId: 'p1', entryId: 'e1' }],
    });
    expect(buildExportModel(args)).toEqual(buildExportModel(args));
  });

  it('never recomputes participant count — it is derived from persisted pool membership, not a formula', () => {
    const model = buildExportModel(
      baseArgs({
        categories: [
          {
            id: 'c1',
            categoryKey: 'A',
            stream: 'S',
            discipline: 'KYORUGI',
            format: 'INDIVIDUAL',
            gender: 'MALE',
            movement: null,
            ageDivisionCode: null,
            weightClassCode: null,
            readiness: 'READY',
          },
        ],
        pools: [{ id: 'p1', categoryId: 'c1', poolUid: 'A-1', ordinal: 1, isWalkover: false, warnings: [] }],
        entries: [entry('e1', 'Budi'), entry('e2', 'Ani')],
        poolMembers: [
          { poolId: 'p1', entryId: 'e1' },
          { poolId: 'p1', entryId: 'e2' },
        ],
      }),
    );
    expect(model.categories[0]?.participantCount).toBe(2);
  });
});
