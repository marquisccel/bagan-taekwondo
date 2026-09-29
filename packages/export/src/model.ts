import { compareCategoriesByWeightClass, resolveMatchNumbers } from '@bagantkd/shared';

/**
 * The canonical export view model (Phase 6 ACCEPTANCE §3). Every renderer (PDF, XLSX) consumes
 * ONLY this shape — never the database directly — so pools/brackets/BYEs/seeds/quality/contingent
 * separation are read exactly as Phase 3/4 computed and persisted them, never recomputed here.
 *
 * `buildExportModel` is a pure function: given the same raw rows, it always produces the same
 * model, with every list explicitly ordered (never relying on incidental SQL/DB row order). That
 * determinism is what makes the semantic export fingerprint (fingerprint.ts) meaningful.
 */

export interface ExportAthleteDisplay {
  readonly fullName: string | null;
  readonly gender: string | null;
  readonly weightG: number | null;
  readonly heightMm: number | null;
  readonly beltCode: string | null;
  /**
   * The rule set's own curated human label for this belt (e.g. "Geup 9 (kuning)") — already curated
   * domain data (`rule_belt.label`), not invented here. Optional: absent for synthetic fixtures and
   * any snapshot taken before this field existed; renderers fall back to humanizing `beltCode`.
   */
  readonly beltLabel?: string | null;
}

/** Never includes NIK or any other athlete identity field beyond what's needed to print a roster. */
export interface ExportEntry {
  readonly id: string;
  readonly externalRef: string | null;
  readonly displayName: string;
  readonly contingent: string;
  readonly athletes: readonly ExportAthleteDisplay[];
}

export type ExportFeeder =
  | { readonly kind: 'slot'; readonly slot: number }
  | { readonly kind: 'match'; readonly matchUid: string; readonly publicCode: string | null };

export interface ExportMatch {
  readonly id: string;
  readonly matchUid: string;
  readonly publicCode: string | null;
  readonly round: number;
  readonly position: number;
  readonly status: string;
  /** Manually set by the team ("No." on the web bracket) — null when never edited. */
  readonly displayNo: number | null;
  /**
   * The same "No." the team sees on screen, resolved identically here (see
   * `@bagantkd/shared`'s `resolveMatchNumbers`, over the same weight-ascending category order as
   * the web session view) so an unedited match never prints a different number than the screen
   * shows. Always present; falls back to `displayNo` becoming this value once nothing is pinned.
   */
  readonly resolvedDisplayNo: number | null;
  readonly feederA: ExportFeeder;
  readonly feederB: ExportFeeder;
}

export interface ExportBracketSlot {
  readonly position: number;
  readonly seedNo: number | null;
  readonly entry: ExportEntry | null;
  readonly isBye: boolean;
}

export interface ExportBracket {
  readonly id: string;
  readonly size: number;
  readonly rounds: number;
  readonly entries: number;
  readonly byes: number;
  /** Ordered by slot position. */
  readonly slots: readonly ExportBracketSlot[];
  /** Ordered by round, then position — the same order a printed bracket reads in. */
  readonly matches: readonly ExportMatch[];
}

export interface ExportPool {
  readonly id: string;
  readonly poolUid: string;
  readonly ordinal: number;
  readonly isWalkover: boolean;
  /** Human-safe warning labels already decided upstream (Phase 4 quality reasons) — never invented here. */
  readonly warnings: readonly string[];
  /** Ordered by bracket seed position when a bracket exists, otherwise by entry display name. */
  readonly members: readonly ExportEntry[];
  readonly bracket: ExportBracket | null;
}

export interface ExportCategory {
  readonly id: string;
  readonly categoryKey: string;
  readonly stream: string;
  readonly discipline: string;
  readonly format: string;
  readonly gender: string;
  readonly movement: string | null;
  readonly ageDivisionCode: string | null;
  /** The rule set's own human label for this age division (e.g. "Pra Cadet A") — already curated domain data, not derived here. */
  readonly ageDivisionLabel: string | null;
  readonly weightClassCode: string | null;
  readonly readiness: string;
  readonly participantCount: number;
  /** Ordered by pool ordinal. */
  readonly pools: readonly ExportPool[];
}

/**
 * Mirrors the frozen engine's `QualityFinding` (packages/draw-engine/src/contract.ts) exactly —
 * `code` is the only stable machine identifier; there has never been a free-text `message` field
 * upstream. The human-facing explanation is derived at render time from `code` via
 * `presentation.ts`'s `warningLabel`, never invented or stored here.
 */
export interface ExportQualityFinding {
  readonly level: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: string;
  readonly subject: string;
}

export interface ExportQuality {
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  /** Ordered by level (ERROR, WARNING, INFO) then code. */
  readonly findings: readonly ExportQualityFinding[];
}

export interface ExportRevisionMeta {
  readonly id: string;
  readonly revisionNo: number;
  readonly lifecycle: string;
  readonly contentFingerprint: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly lockedAt: string | null;
  readonly publishedAt: string | null;
}

export interface ExportTournamentMeta {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly eventStart: string;
  readonly eventEnd: string;
}

export interface ExportModel {
  readonly tournament: ExportTournamentMeta;
  readonly revision: ExportRevisionMeta;
  readonly quality: ExportQuality;
  /** Ordered by categoryKey — stable regardless of DB insertion order. */
  readonly categories: readonly ExportCategory[];
}

// ---------------------------------------------------------------------------------------
// Raw input rows (as fetched by packages/db/src/export-source.ts) → pure assembly.
// ---------------------------------------------------------------------------------------

export interface RawCategoryRow {
  readonly id: string;
  readonly categoryKey: string;
  readonly stream: string;
  readonly discipline: string;
  readonly format: string;
  readonly gender: string;
  readonly movement: string | null;
  readonly ageDivisionCode: string | null;
  readonly ageDivisionLabel: string | null;
  readonly weightClassCode: string | null;
  readonly readiness: string;
}

export interface RawPoolRow {
  readonly id: string;
  readonly categoryId: string;
  readonly poolUid: string;
  readonly ordinal: number;
  readonly isWalkover: boolean;
  readonly warnings: readonly string[];
}

export interface RawEntryRow {
  readonly id: string;
  readonly externalRef: string | null;
  readonly displayName: string;
  readonly contingent: string;
  readonly athletes: readonly ExportAthleteDisplay[];
}

export interface RawPoolMemberRow {
  readonly poolId: string;
  readonly entryId: string;
}

export interface RawBracketRow {
  readonly id: string;
  readonly poolId: string;
  readonly size: number;
  readonly rounds: number;
  readonly entries: number;
  readonly byes: number;
}

export interface RawBracketSlotRow {
  readonly bracketId: string;
  readonly position: number;
  readonly seedNo: number | null;
  readonly entryId: string | null;
}

export interface RawMatchRow {
  readonly id: string;
  readonly bracketId: string;
  readonly matchUid: string;
  readonly publicCode: string | null;
  readonly round: number;
  readonly position: number;
  readonly status: string;
  readonly feederASlot: number | null;
  readonly feederAMatchId: string | null;
  readonly feederBSlot: number | null;
  readonly feederBMatchId: string | null;
  /** Optional: absent for synthetic fixtures and snapshots taken before this column existed. */
  readonly displayNo?: number | null;
}

export interface BuildExportModelArgs {
  readonly tournament: ExportTournamentMeta;
  readonly revision: ExportRevisionMeta;
  readonly quality: ExportQuality | null;
  readonly categories: readonly RawCategoryRow[];
  readonly pools: readonly RawPoolRow[];
  readonly poolMembers: readonly RawPoolMemberRow[];
  readonly entries: readonly RawEntryRow[];
  readonly brackets: readonly RawBracketRow[];
  readonly bracketSlots: readonly RawBracketSlotRow[];
  readonly matches: readonly RawMatchRow[];
}

const byId = <T extends { readonly id: string }>(rows: readonly T[]): ReadonlyMap<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

const feederFor = (
  slot: number | null,
  matchId: string | null,
  publicCodeByMatchId: ReadonlyMap<string, string | null>,
  matchUidByMatchId: ReadonlyMap<string, string>,
): ExportFeeder =>
  slot !== null
    ? { kind: 'slot', slot }
    : {
        kind: 'match',
        matchUid: matchUidByMatchId.get(matchId ?? '') ?? '',
        publicCode: publicCodeByMatchId.get(matchId ?? '') ?? null,
      };

/**
 * Pure assembly: raw rows in, canonical ExportModel out. No I/O, no wall clock, no randomness — the
 * only "computation" here is sorting into an explicit deterministic order, never recomputing what
 * pools/brackets/BYEs/seeds a category should have.
 */
export function buildExportModel(args: BuildExportModelArgs): ExportModel {
  const entryById = byId(args.entries);
  const poolsByCategory = new Map<string, RawPoolRow[]>();
  for (const p of args.pools) {
    const list = poolsByCategory.get(p.categoryId) ?? [];
    list.push(p);
    poolsByCategory.set(p.categoryId, list);
  }
  const membersByPool = new Map<string, string[]>();
  for (const m of args.poolMembers) {
    const list = membersByPool.get(m.poolId) ?? [];
    list.push(m.entryId);
    membersByPool.set(m.poolId, list);
  }
  const bracketByPool = new Map(args.brackets.map((b) => [b.poolId, b]));
  const slotsByBracket = new Map<string, RawBracketSlotRow[]>();
  for (const s of args.bracketSlots) {
    const list = slotsByBracket.get(s.bracketId) ?? [];
    list.push(s);
    slotsByBracket.set(s.bracketId, list);
  }
  const matchesByBracket = new Map<string, RawMatchRow[]>();
  for (const m of args.matches) {
    const list = matchesByBracket.get(m.bracketId) ?? [];
    list.push(m);
    matchesByBracket.set(m.bracketId, list);
  }
  const publicCodeByMatchId = new Map(args.matches.map((m) => [m.id, m.publicCode]));
  const matchUidByMatchId = new Map(args.matches.map((m) => [m.id, m.matchUid]));

  // Weight-ascending order (not plain categoryKey string sort) so a category's position here is the
  // exact same as the web session view (`RevisionReadController.session`) -- required for
  // `resolvedDisplayNo` below to print the identical number the team sees on screen.
  const sortedCategories = [...args.categories].sort(compareCategoriesByWeightClass);
  const categoryIndexById = new Map(sortedCategories.map((c, i) => [c.id, i]));
  const poolById = new Map(args.pools.map((p) => [p.id, p]));
  const bracketById = new Map(args.brackets.map((b) => [b.id, b]));
  const resolvedNumberByMatchId = resolveMatchNumbers(
    args.matches.map((m) => {
      const bracket = bracketById.get(m.bracketId);
      const pool = bracket ? poolById.get(bracket.poolId) : undefined;
      return {
        id: m.id,
        displayNo: m.displayNo ?? null,
        order: [
          pool ? (categoryIndexById.get(pool.categoryId) ?? 0) : 0,
          pool?.ordinal ?? 0,
          m.round,
          m.position,
        ],
      };
    }),
  );

  const categories: ExportCategory[] = sortedCategories.map((c) => {
      const rawPools = [...(poolsByCategory.get(c.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal);
      let participantCount = 0;

      const pools: ExportPool[] = rawPools.map((p) => {
        const bracket = bracketByPool.get(p.id) ?? null;
        const memberIds = membersByPool.get(p.id) ?? [];
        participantCount += memberIds.length;

        let members: ExportEntry[];
        let exportBracket: ExportBracket | null = null;
        if (bracket) {
          const slots = [...(slotsByBracket.get(bracket.id) ?? [])].sort((a, b) => a.position - b.position);
          const matches = [...(matchesByBracket.get(bracket.id) ?? [])].sort(
            (a, b) => a.round - b.round || a.position - b.position,
          );
          const bracketSlots: ExportBracketSlot[] = slots.map((s) => ({
            position: s.position,
            seedNo: s.seedNo,
            entry: s.entryId ? (entryById.get(s.entryId) ?? null) : null,
            isBye: s.entryId === null,
          }));
          exportBracket = {
            id: bracket.id,
            size: bracket.size,
            rounds: bracket.rounds,
            entries: bracket.entries,
            byes: bracket.byes,
            slots: bracketSlots,
            matches: matches.map((m) => ({
              id: m.id,
              matchUid: m.matchUid,
              publicCode: m.publicCode,
              round: m.round,
              position: m.position,
              status: m.status,
              displayNo: m.displayNo ?? null,
              resolvedDisplayNo: resolvedNumberByMatchId.get(m.id) ?? null,
              feederA: feederFor(m.feederASlot, m.feederAMatchId, publicCodeByMatchId, matchUidByMatchId),
              feederB: feederFor(m.feederBSlot, m.feederBMatchId, publicCodeByMatchId, matchUidByMatchId),
            })),
          };
          members = bracketSlots
            .filter((s): s is ExportBracketSlot & { entry: ExportEntry } => s.entry !== null)
            .map((s) => s.entry);
        } else {
          members = memberIds
            .map((id) => entryById.get(id))
            .filter((e): e is ExportEntry => e !== undefined)
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        }

        return {
          id: p.id,
          poolUid: p.poolUid,
          ordinal: p.ordinal,
          isWalkover: p.isWalkover,
          warnings: p.warnings,
          members,
          bracket: exportBracket,
        };
      });

      return {
        id: c.id,
        categoryKey: c.categoryKey,
        stream: c.stream,
        discipline: c.discipline,
        format: c.format,
        gender: c.gender,
        movement: c.movement,
        ageDivisionCode: c.ageDivisionCode,
        ageDivisionLabel: c.ageDivisionLabel,
        weightClassCode: c.weightClassCode,
        readiness: c.readiness,
        participantCount,
        pools,
      };
    });

  return {
    tournament: args.tournament,
    revision: args.revision,
    quality: args.quality ?? { errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    categories,
  };
}
