import {
  buildExportModel,
  type ExportModel,
  type RawBracketSlotRow,
  type RawEntryRow,
  type RawMatchRow,
} from '../model.js';

/** Smallest power of two >= n (bracket sizing convention shared with the Phase 3 engine). */
function bracketSizeFor(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export interface FixtureOptions {
  readonly participantCount: number;
  readonly longNames?: boolean;
  readonly longContingentNames?: boolean;
  readonly discipline?: 'KYORUGI' | 'POOMSAE';
}

const LONG_NAME = 'Muhammad Abdurrahman Wicaksono Prasetyo Nugroho Setiawan';
const LONG_CONTINGENT = 'Kontingen Persatuan Taekwondo Kabupaten Bogor Raya Selatan';

/**
 * Builds a synthetic single-category, single-pool ExportModel of a given size, entirely
 * independent of the database and the draw engine — used only to exercise the render/pagination
 * layer against the size matrix and edge cases the spec requires (ACCEPTANCE §PDF rendering), not
 * to test drawing logic (which is Phase 3's frozen concern).
 */
export function makeFixtureModel(opts: FixtureOptions): ExportModel {
  const n = opts.participantCount;
  const size = bracketSizeFor(n);
  const rounds = Math.log2(size);
  const discipline = opts.discipline ?? 'KYORUGI';

  const entries: RawEntryRow[] = Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    externalRef: `EXT-${i}`,
    displayName: opts.longNames ? `${LONG_NAME} ${i}` : `Peserta ${i + 1}`,
    contingent: opts.longContingentNames ? `${LONG_CONTINGENT} ${i}` : `Kontingen ${(i % 5) + 1}`,
    athletes: [
      {
        fullName: opts.longNames ? `${LONG_NAME} ${i}` : `Peserta ${i + 1}`,
        gender: 'MALE',
        weightG: 55000 + i * 500,
        heightMm: 1650 + i,
        beltCode: 'HITAM',
      },
    ],
  }));

  const slots: RawBracketSlotRow[] = Array.from({ length: size }, (_, position) => ({
    bracketId: 'b1',
    position,
    seedNo: position < n ? position + 1 : null,
    entryId: position < n ? `e${position}` : null,
  }));

  const matches: RawMatchRow[] = [];
  let idCounter = 0;
  let prevRoundMatchIds: (string | null)[] = [];
  for (let round = 1; round <= rounds; round++) {
    const matchesInRound = size / 2 ** round;
    const roundMatchIds: string[] = [];
    for (let position = 1; position <= matchesInRound; position++) {
      const id = `m${idCounter++}`;
      roundMatchIds.push(id);
      const feederASlot = round === 1 ? (position - 1) * 2 : null;
      const feederBSlot = round === 1 ? (position - 1) * 2 + 1 : null;
      const feederAMatchId = round === 1 ? null : (prevRoundMatchIds[(position - 1) * 2] ?? null);
      const feederBMatchId = round === 1 ? null : (prevRoundMatchIds[(position - 1) * 2 + 1] ?? null);
      matches.push({
        id,
        bracketId: 'b1',
        matchUid: id,
        publicCode: `A-1-R${round}-${position}`,
        round,
        position,
        status: 'PENDING',
        feederASlot,
        feederAMatchId,
        feederBSlot,
        feederBMatchId,
      });
    }
    prevRoundMatchIds = roundMatchIds;
  }

  return buildExportModel({
    tournament: {
      id: 't1',
      code: 'PU2026',
      name: 'Piala Uji 2026',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
    },
    revision: {
      id: 'r1',
      revisionNo: 1,
      lifecycle: 'PUBLISHED',
      contentFingerprint: 'sha256:fixture',
      submittedAt: '2026-08-01T00:00:00Z',
      approvedAt: '2026-08-02T00:00:00Z',
      lockedAt: '2026-08-03T00:00:00Z',
      publishedAt: '2026-08-04T00:00:00Z',
    },
    quality: {
      errorCount: 0,
      warningCount: n > 32 ? 1 : 0,
      infoCount: 0,
      findings: n > 32 ? [{ level: 'WARNING', code: 'LARGE_BRACKET', message: 'Bagan besar' }] : [],
    },
    categories: [
      {
        id: 'c1',
        categoryKey: `FIX-${n}`,
        stream: 'PRESTASI',
        discipline,
        format: 'INDIVIDUAL',
        gender: 'MALE',
        movement: discipline === 'POOMSAE' ? 'TUNGGAL' : null,
        ageDivisionCode: 'DEWASA',
        weightClassCode: discipline === 'KYORUGI' ? '-58KG' : null,
        readiness: 'READY',
      },
    ],
    pools: [
      {
        id: 'p1',
        categoryId: 'c1',
        poolUid: 'A-1',
        ordinal: 1,
        isWalkover: false,
        warnings: n > 32 ? ['bagan besar'] : [],
      },
    ],
    poolMembers: entries.map((e) => ({ poolId: 'p1', entryId: e.id })),
    entries,
    brackets: [{ id: 'b1', poolId: 'p1', size, rounds, entries: n, byes: size - n }],
    bracketSlots: slots,
    matches,
  });
}
