import {
  buildExportModel,
  type ExportAthleteDisplay,
  type ExportModel,
  type RawBracketRow,
  type RawBracketSlotRow,
  type RawCategoryRow,
  type RawEntryRow,
  type RawMatchRow,
  type RawPoolMemberRow,
  type RawPoolRow,
} from '../model.js';

/**
 * Synthetic multi-category / multi-pool ExportModel for the compact semi-prestasi sheet (AUD-012),
 * independent of the database and the draw engine — it only feeds the render layer with realistic
 * shapes (several small pools per category, BYE slots, missing belt/height/weight, long names,
 * Poomsae movement/format, a non-semi-prestasi category that must be excluded). Synthetic names only.
 */
export interface SemiFixtureCategory {
  readonly key: string;
  readonly discipline: 'KYORUGI' | 'POOMSAE';
  readonly stream?: 'SEMI_PRESTASI' | 'PRESTASI';
  readonly format?: 'INDIVIDUAL' | 'PAIR' | 'TEAM';
  readonly gender?: 'MALE' | 'FEMALE' | 'MIXED';
  readonly ageDivisionCode?: string;
  readonly ageDivisionLabel?: string;
  readonly weightClassCode?: string | null;
  readonly movement?: string | null;
  /** Participants per pool, one entry per pool (pool ordinal = index + 1). */
  readonly poolSizes: readonly number[];
  readonly longNames?: boolean;
  /** Leave belt / height / weight unpersisted on every athlete. */
  readonly missing?: { readonly belt?: boolean; readonly height?: boolean; readonly weight?: boolean };
  /** Persisted warning codes per pool (index = pool index). */
  readonly poolWarnings?: readonly (readonly string[])[];
  /** Mark these pool indexes as walkover pools (no bracket is persisted for them). */
  readonly walkoverPools?: readonly number[];
}

const BELTS = ['GEUP_9', 'GEUP_8', 'GEUP_7', 'GEUP_6', 'GEUP_5', 'GEUP_4'] as const;
/** Mirrors the real ruleset's curated `rule_belt.label` shape (fixtures/rulesets/piala-gubernur-2026.provisional.json) so synthetic PDFs exercise the same rendering path as production. */
const BELT_LABELS: Readonly<Record<(typeof BELTS)[number], string>> = {
  GEUP_9: 'Geup 9 (kuning)',
  GEUP_8: 'Geup 8 (kuning strip hijau)',
  GEUP_7: 'Geup 7 (hijau)',
  GEUP_6: 'Geup 6 (hijau strip biru)',
  GEUP_5: 'Geup 5 (biru)',
  GEUP_4: 'Geup 4 (biru strip merah)',
};
const LONG_NAME = 'Muhammad Abdurrahman Wicaksono Prasetyo Nugroho Setiawan';
const LONG_CONTINGENT = 'Kontingen Persatuan Taekwondo Kabupaten Bogor Raya Selatan';

const sizeFor = (n: number): number => {
  let size = 1;
  while (size < n) size *= 2;
  return size;
};

export function makeSemiPrestasiFixtureModel(
  categories: readonly SemiFixtureCategory[],
  overrides: { readonly lifecycle?: string; readonly quality?: { errors: number; warnings: number } } = {},
): ExportModel {
  const rawCategories: RawCategoryRow[] = [];
  const pools: RawPoolRow[] = [];
  const poolMembers: RawPoolMemberRow[] = [];
  const entries: RawEntryRow[] = [];
  const brackets: RawBracketRow[] = [];
  const bracketSlots: RawBracketSlotRow[] = [];
  const matches: RawMatchRow[] = [];

  categories.forEach((cat, ci) => {
    const categoryId = `c${ci + 1}`;
    rawCategories.push({
      id: categoryId,
      categoryKey: cat.key,
      stream: cat.stream ?? 'SEMI_PRESTASI',
      discipline: cat.discipline,
      format: cat.format ?? 'INDIVIDUAL',
      gender: cat.gender ?? 'MALE',
      movement: cat.discipline === 'POOMSAE' ? (cat.movement ?? 'TUNGGAL') : null,
      ageDivisionCode: cat.ageDivisionCode ?? 'PRA_CADET_C',
      ageDivisionLabel: cat.ageDivisionLabel ?? 'Pra Cadet C',
      weightClassCode:
        cat.discipline === 'KYORUGI'
          ? cat.weightClassCode === undefined
            ? '-41'
            : cat.weightClassCode
          : null,
      readiness: 'READY',
    });

    cat.poolSizes.forEach((n, pi) => {
      const poolId = `${categoryId}-p${pi + 1}`;
      const bracketId = `${poolId}-b`;
      const isWalkover = cat.walkoverPools?.includes(pi) ?? false;
      pools.push({
        id: poolId,
        categoryId,
        poolUid: `${categoryId}-${pi + 1}`,
        ordinal: pi + 1,
        isWalkover,
        warnings: cat.poolWarnings?.[pi] ?? [],
      });

      const poolEntryIds: string[] = [];
      for (let i = 0; i < n; i++) {
        const entryId = `${poolId}-e${i}`;
        poolEntryIds.push(entryId);
        const base = cat.longNames ? LONG_NAME : `Peserta ${ci + 1}${String.fromCharCode(65 + pi)}`;
        const name = `${base} ${i + 1}`;
        const athlete = (suffix: string): ExportAthleteDisplay => {
          const beltCode = cat.missing?.belt ? null : (BELTS[(pi + i) % BELTS.length] ?? null);
          return {
            fullName: `${name}${suffix}`,
            gender: cat.gender === 'FEMALE' ? 'FEMALE' : 'MALE',
            weightG: cat.missing?.weight ? null : 34000 + (pi * 7 + i * 3) * 250,
            heightMm: cat.missing?.height ? null : 1420 + (pi * 5 + i * 4) * 11,
            beltCode,
            beltLabel: beltCode ? BELT_LABELS[beltCode] : null,
          };
        };
        const pairSize = cat.format === 'PAIR' ? 2 : cat.format === 'TEAM' ? 3 : 1;
        const athletes = Array.from({ length: pairSize }, (_, k) => athlete(pairSize > 1 ? ` ${k + 1}` : ''));
        entries.push({
          id: entryId,
          externalRef: `EXT-${entryId}`,
          displayName: athletes.map((a) => a.fullName).join(' / '),
          contingent: cat.longNames ? `${LONG_CONTINGENT} ${i}` : `Kontingen ${((ci + pi + i) % 5) + 1}`,
          athletes,
        });
        poolMembers.push({ poolId, entryId });
      }

      if (isWalkover || n === 0) return;

      const size = sizeFor(n);
      const rounds = Math.log2(size);
      brackets.push({ id: bracketId, poolId, size, rounds, entries: n, byes: size - n });
      // One bye per round-1 pair, taken from the last `byes` pairs (INV-04: no bye-vs-bye first-round
      // pair, always guaranteed by the real engine) -- naively clustering all byes at the tail
      // positions would put two byes in the same pair whenever byes >= 2, which the real engine never
      // produces.
      const byes = size - n;
      const numPairs = size / 2;
      const isByePosition = (position: number): boolean =>
        position % 2 === 1 && Math.floor(position / 2) >= numPairs - byes;
      let nextEntry = 0;
      for (let position = 0; position < size; position++) {
        if (isByePosition(position)) {
          bracketSlots.push({ bracketId, position, seedNo: null, entryId: null });
          continue;
        }
        const entryIndex = nextEntry++;
        bracketSlots.push({
          bracketId,
          position,
          seedNo: entryIndex + 1,
          entryId: poolEntryIds[entryIndex] ?? null,
        });
      }
      let prev: string[] = [];
      for (let round = 1; round <= rounds; round++) {
        const inRound = size / 2 ** round;
        const ids: string[] = [];
        for (let position = 1; position <= inRound; position++) {
          const id = `${bracketId}-m${round}-${position}`;
          ids.push(id);
          const feederASlot = round === 1 ? (position - 1) * 2 : null;
          const feederBSlot = round === 1 ? (position - 1) * 2 + 1 : null;
          // Mirrors the real engine/repository (packages/db/src/draw-run-repository.ts,
          // command-repository.ts: `m.real ? 'PENDING' : 'WALKOVER'`): a round-1 pairing where either
          // slot is a bye is a walkover, not a contest, so the renderer must never draw it as a real
          // match.
          const isByeSlot = (slot: number | null): boolean => slot !== null && isByePosition(slot);
          matches.push({
            id,
            bracketId,
            matchUid: id,
            publicCode: `${String.fromCharCode(65 + ci)}${pi + 1}-R${round}-${position}`,
            round,
            position,
            status:
              round === 1 && (isByeSlot(feederASlot) || isByeSlot(feederBSlot)) ? 'WALKOVER' : 'PENDING',
            feederASlot,
            feederBSlot,
            feederAMatchId: round === 1 ? null : (prev[(position - 1) * 2] ?? null),
            feederBMatchId: round === 1 ? null : (prev[(position - 1) * 2 + 1] ?? null),
          });
        }
        prev = ids;
      }
    });
  });

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
      revisionNo: 3,
      lifecycle: overrides.lifecycle ?? 'PUBLISHED',
      contentFingerprint: 'sha256:semi-fixture',
      submittedAt: '2026-08-01T00:00:00Z',
      approvedAt: '2026-08-02T00:00:00Z',
      lockedAt: '2026-08-03T00:00:00Z',
      publishedAt: '2026-08-04T00:00:00Z',
    },
    quality: overrides.quality
      ? {
          errorCount: overrides.quality.errors,
          warningCount: overrides.quality.warnings,
          infoCount: 0,
          findings: [],
        }
      : null,
    categories: rawCategories,
    pools,
    poolMembers,
    entries,
    brackets,
    bracketSlots,
    matches,
  });
}
