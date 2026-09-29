import type { Db } from '@bagantkd/db';
import { compareCategoriesByWeightClass, resolveMatchNumbers } from '@bagantkd/shared';
import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

function sessionCategorySort(a: { category_key: string; gender: string }, b: typeof a): number {
  return compareCategoriesByWeightClass(
    { categoryKey: a.category_key, gender: a.gender },
    { categoryKey: b.category_key, gender: b.gender },
  );
}

interface EntryDisplay {
  readonly entryId: string;
  readonly externalRef: string | null;
  readonly contingent: string;
  readonly displayName: string;
  readonly athletes: readonly {
    readonly fullName: string | null;
    readonly gender: string | null;
    readonly weightG: number | null;
    readonly heightMm: number | null;
    readonly beltCode: string | null;
    readonly beltLabel: string | null;
  }[];
}

/**
 * Read-only revision/category views for the Phase 5 operator UI (ACCEPTANCE §A/§B). Never selects
 * `athlete.nik_ciphertext` / `nik_blind_index` — display fields only.
 */
@Controller('revisions/:id')
@UseGuards(ActorGuard)
@TournamentScope('revision', 'id')
export class RevisionReadController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async get(@Param('id') id: string): Promise<Record<string, unknown>> {
    const [row] = await this.db.query(
      `select id, tournament_id, draw_run_id, revision_no, parent_revision_id, lifecycle, content_fingerprint, lock_version,
              created_at, submitted_at, approved_at, locked_at, published_at
       from draw_revision where id = $1`,
      [id],
    );
    if (!row) throw new ApiError('REVISION_NOT_FOUND');
    return row;
  }

  @Get('categories')
  async categories(@Param('id') id: string): Promise<readonly Record<string, unknown>[]> {
    const [rev] = await this.db.query<{ draw_run_id: string }>(
      `select draw_run_id from draw_revision where id = $1`,
      [id],
    );
    if (!rev) throw new ApiError('REVISION_NOT_FOUND');

    const categories = await this.db.query<{
      category_id: string;
      category_key: string;
      stream: string;
      discipline: string;
      format: string;
      gender: string;
      movement: string | null;
      readiness: string;
      blocked_reasons: unknown;
      selected_strategy: string | null;
    }>(
      `select rc.category_id, c.category_key, c.stream, c.discipline, c.format, c.gender, c.movement, rc.readiness, rc.blocked_reasons, rc.selected_strategy
       from draw_run_category rc join category c on c.id = rc.category_id where rc.draw_run_id = $1 order by c.category_key`,
      [rev.draw_run_id],
    );
    if (categories.length === 0) return [];
    categories.sort(sessionCategorySort);

    const categoryIds = categories.map((c) => c.category_id);
    const pools = await this.db.query<{
      category_id: string;
      id: string;
      is_walkover: boolean;
      explanation: unknown;
    }>(
      `select category_id, id, is_walkover, explanation from pool where revision_id = $1 and category_id = any($2::uuid[])`,
      [id, categoryIds],
    );
    const memberCounts = await this.db.query<{ category_id: string; n: string }>(
      `select p.category_id, count(pm.entry_id)::int n from pool p join pool_member pm on pm.pool_id = p.id where p.revision_id = $1 and p.category_id = any($2::uuid[]) group by p.category_id`,
      [id, categoryIds],
    );

    return categories.map((c) => {
      const catPools = pools.filter((p) => p.category_id === c.category_id);
      const hasWarning = catPools.some(
        (p) => p.is_walkover || (Array.isArray(p.explanation) && p.explanation.length > 0),
      );
      const entryCount = Number(memberCounts.find((m) => m.category_id === c.category_id)?.n ?? 0);
      const quality: 'GREEN' | 'YELLOW' | 'RED' =
        c.readiness === 'BLOCKED' ? 'RED' : hasWarning ? 'YELLOW' : 'GREEN';
      return { ...c, poolCount: catPools.length, entryCount, quality };
    });
  }

  /**
   * The whole revision's pools/members (TB/BB/Sabuk included) AND their brackets/matches, in one
   * call, across every category — the "session view" the team checks arena-by-arena, laid out like
   * the committee's own SPS arena tab rather than one category at a time. Pool assignment and match
   * numbering both happen from here; the per-category detail page stays available separately but is
   * no longer the primary path.
   */
  @Get('session')
  async session(@Param('id') id: string): Promise<readonly Record<string, unknown>[]> {
    const [rev] = await this.db.query<{ draw_run_id: string; tournament_id: string }>(
      `select draw_run_id, tournament_id from draw_revision where id = $1`,
      [id],
    );
    if (!rev) throw new ApiError('REVISION_NOT_FOUND');

    const categories = await this.db.query<{
      category_id: string;
      category_key: string;
      stream: string;
      discipline: string;
      format: string;
      gender: string;
      movement: string | null;
    }>(
      `select rc.category_id, c.category_key, c.stream, c.discipline, c.format, c.gender, c.movement
       from draw_run_category rc join category c on c.id = rc.category_id
       where rc.draw_run_id = $1 order by c.category_key`,
      [rev.draw_run_id],
    );
    if (categories.length === 0) return [];
    categories.sort(sessionCategorySort);

    const categoryIds = categories.map((c) => c.category_id);
    const pools = await this.db.query<{
      category_id: string;
      id: string;
      pool_uid: string;
      ordinal: number;
      is_walkover: boolean;
      explanation: unknown;
    }>(
      `select category_id, id, pool_uid, ordinal, is_walkover, explanation
       from pool where revision_id = $1 and category_id = any($2::uuid[]) order by ordinal`,
      [id, categoryIds],
    );
    const poolIds = pools.map((p) => p.id);
    const members = poolIds.length
      ? await this.db.query<{ pool_id: string; entry_id: string }>(
          `select pool_id, entry_id from pool_member where pool_id = any($1::uuid[])`,
          [poolIds],
        )
      : [];
    const entryIds = [...new Set(members.map((m) => m.entry_id))];
    const entries: EntryDisplay[] = entryIds.length
      ? await this.loadEntryDisplays(entryIds, rev.tournament_id)
      : [];
    const entryById = new Map(entries.map((e) => [e.entryId, e]));

    const brackets = poolIds.length
      ? await this.db.query<{
          id: string;
          pool_id: string;
          size: number;
          rounds: number;
          entries: number;
          byes: number;
        }>(`select id, pool_id, size, rounds, entries, byes from bracket where pool_id = any($1::uuid[])`, [
          poolIds,
        ])
      : [];
    const bracketIds = brackets.map((b) => b.id);
    const matches = bracketIds.length
      ? await this.db.query<{
          id: string;
          bracket_id: string;
          match_uid: string;
          round: number;
          position: number;
          feeder_a_slot: number | null;
          feeder_a_match_id: string | null;
          feeder_b_slot: number | null;
          feeder_b_match_id: string | null;
          public_code: string | null;
          display_no: number | null;
          status: string;
        }>(
          `select id, bracket_id, match_uid, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, public_code, display_no, status
           from match where bracket_id = any($1::uuid[]) order by round, position`,
          [bracketIds],
        )
      : [];
    const slots = bracketIds.length
      ? await this.db.query<{
          bracket_id: string;
          position: number;
          entry_id: string | null;
          seed_no: number | null;
          bye_reason: unknown;
        }>(
          `select bracket_id, position, entry_id, seed_no, bye_reason from bracket_slot where bracket_id = any($1::uuid[]) order by position`,
          [bracketIds],
        )
      : [];
    const publicCodeByMatchId = new Map(matches.map((m) => [m.id, m.public_code]));

    const poolById = new Map(pools.map((p) => [p.id, p]));
    const bracketById = new Map(brackets.map((b) => [b.id, b]));
    const categoryIndexById = new Map(categories.map((c, i) => [c.category_id, i]));
    const resolvedNumbers = resolveMatchNumbers(
      matches.map((m) => {
        const bracket = bracketById.get(m.bracket_id);
        const pool = bracket ? poolById.get(bracket.pool_id) : undefined;
        return {
          id: m.id,
          displayNo: m.display_no,
          order: [
            pool ? (categoryIndexById.get(pool.category_id) ?? 0) : 0,
            pool?.ordinal ?? 0,
            m.round,
            m.position,
          ],
        };
      }),
    );

    return categories.map((c) => ({
      category: c,
      pools: pools
        .filter((p) => p.category_id === c.category_id)
        .map((p) => {
          const bracket = brackets.find((b) => b.pool_id === p.id) ?? null;
          const bracketSlots = bracket
            ? slots
                .filter((s) => s.bracket_id === bracket.id)
                .map((s) => ({ ...s, entry: s.entry_id ? (entryById.get(s.entry_id) ?? null) : null }))
            : [];
          const bracketMatches = bracket
            ? matches
                .filter((m) => m.bracket_id === bracket.id)
                .map((m) => ({
                  id: m.id,
                  matchUid: m.match_uid,
                  round: m.round,
                  position: m.position,
                  publicCode: m.public_code,
                  displayNo: m.display_no,
                  resolvedDisplayNo: resolvedNumbers.get(m.id) ?? null,
                  status: m.status,
                  feederA:
                    m.feeder_a_slot !== null
                      ? { kind: 'slot' as const, slot: m.feeder_a_slot }
                      : {
                          kind: 'match' as const,
                          publicCode: publicCodeByMatchId.get(m.feeder_a_match_id ?? '') ?? null,
                        },
                  feederB:
                    m.feeder_b_slot !== null
                      ? { kind: 'slot' as const, slot: m.feeder_b_slot }
                      : {
                          kind: 'match' as const,
                          publicCode: publicCodeByMatchId.get(m.feeder_b_match_id ?? '') ?? null,
                        },
                }))
            : [];
          return {
            id: p.id,
            poolUid: p.pool_uid,
            ordinal: p.ordinal,
            isWalkover: p.is_walkover,
            explanation: p.explanation,
            members: members
              .filter((m) => m.pool_id === p.id)
              .map((m) => entryById.get(m.entry_id))
              .filter((e): e is EntryDisplay => !!e),
            bracket: bracket
              ? {
                  id: bracket.id,
                  size: bracket.size,
                  rounds: bracket.rounds,
                  entries: bracket.entries,
                  byes: bracket.byes,
                  slots: bracketSlots,
                  matches: bracketMatches,
                }
              : null,
          };
        }),
    }));
  }

  @Get('categories/:categoryId')
  async categoryDetail(
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ): Promise<Record<string, unknown>> {
    const [category] = await this.db.query(
      `select id, category_key, stream, discipline, format, gender, movement, age_division_id, weight_class_id from category where id = $1`,
      [categoryId],
    );
    if (!category) throw new ApiError('VALIDATION_ERROR', 'category not found');

    const [rev] = await this.db.query<{ draw_run_id: string; tournament_id: string }>(
      `select draw_run_id, tournament_id from draw_revision where id = $1`,
      [id],
    );
    if (!rev) throw new ApiError('REVISION_NOT_FOUND');
    const [runCat] = await this.db.query<{
      readiness: string;
      blocked_reasons: unknown;
      selected_strategy: string | null;
    }>(
      `select readiness, blocked_reasons, selected_strategy from draw_run_category where draw_run_id = $1 and category_id = $2`,
      [rev.draw_run_id, categoryId],
    );

    const pools = await this.db.query<{
      id: string;
      pool_uid: string;
      ordinal: number;
      is_walkover: boolean;
      metrics: unknown;
      explanation: unknown;
    }>(
      `select id, pool_uid, ordinal, is_walkover, metrics, explanation from pool where revision_id = $1 and category_id = $2 order by ordinal`,
      [id, categoryId],
    );
    if (pools.length === 0)
      return {
        category,
        readiness: runCat?.readiness ?? 'BLOCKED',
        blockedReasons: runCat?.blocked_reasons ?? [],
        selectedStrategy: null,
        pools: [],
      };
    const poolIds = pools.map((p) => p.id);

    const members = await this.db.query<{ pool_id: string; entry_id: string }>(
      `select pool_id, entry_id from pool_member where pool_id = any($1::uuid[])`,
      [poolIds],
    );
    const entryIds = [...new Set(members.map((m) => m.entry_id))];
    const entries: EntryDisplay[] = entryIds.length
      ? await this.loadEntryDisplays(entryIds, rev.tournament_id)
      : [];
    const entryById = new Map(entries.map((e) => [e.entryId, e]));

    const brackets = await this.db.query<{
      id: string;
      pool_id: string;
      size: number;
      rounds: number;
      entries: number;
      byes: number;
    }>(`select id, pool_id, size, rounds, entries, byes from bracket where pool_id = any($1::uuid[])`, [
      poolIds,
    ]);
    const bracketIds = brackets.map((b) => b.id);
    const slots = bracketIds.length
      ? await this.db.query<{
          bracket_id: string;
          position: number;
          entry_id: string | null;
          seed_no: number | null;
          bye_reason: unknown;
        }>(
          `select bracket_id, position, entry_id, seed_no, bye_reason from bracket_slot where bracket_id = any($1::uuid[]) order by position`,
          [bracketIds],
        )
      : [];
    const matches = bracketIds.length
      ? await this.db.query<{
          id: string;
          bracket_id: string;
          match_uid: string;
          round: number;
          position: number;
          feeder_a_slot: number | null;
          feeder_a_match_id: string | null;
          feeder_b_slot: number | null;
          feeder_b_match_id: string | null;
          public_code: string | null;
          display_no: number | null;
          status: string;
        }>(
          `select id, bracket_id, match_uid, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, public_code, display_no, status
           from match where bracket_id = any($1::uuid[]) order by round, position`,
          [bracketIds],
        )
      : [];
    const publicCodeByMatchId = new Map(matches.map((m) => [m.id, m.public_code]));

    const poolById = new Map(pools.map((p) => [p.id, p]));
    const bracketById = new Map(brackets.map((b) => [b.id, b]));
    const resolvedNumbers = resolveMatchNumbers(
      matches.map((m) => {
        const bracket = bracketById.get(m.bracket_id);
        const pool = bracket ? poolById.get(bracket.pool_id) : undefined;
        return { id: m.id, displayNo: m.display_no, order: [0, pool?.ordinal ?? 0, m.round, m.position] };
      }),
    );

    const result = pools.map((p) => {
      const poolMembers = members
        .filter((m) => m.pool_id === p.id)
        .map((m) => entryById.get(m.entry_id))
        .filter((e): e is EntryDisplay => !!e);
      const bracket = brackets.find((b) => b.pool_id === p.id) ?? null;
      const bracketSlots = bracket
        ? slots
            .filter((s) => s.bracket_id === bracket.id)
            .map((s) => ({ ...s, entry: s.entry_id ? (entryById.get(s.entry_id) ?? null) : null }))
        : [];
      const bracketMatches = bracket
        ? matches
            .filter((m) => m.bracket_id === bracket.id)
            .map((m) => ({
              id: m.id,
              matchUid: m.match_uid,
              round: m.round,
              position: m.position,
              publicCode: m.public_code,
              displayNo: m.display_no,
              resolvedDisplayNo: resolvedNumbers.get(m.id) ?? null,
              status: m.status,
              feederA:
                m.feeder_a_slot !== null
                  ? { kind: 'slot' as const, slot: m.feeder_a_slot }
                  : {
                      kind: 'match' as const,
                      publicCode: publicCodeByMatchId.get(m.feeder_a_match_id ?? '') ?? null,
                    },
              feederB:
                m.feeder_b_slot !== null
                  ? { kind: 'slot' as const, slot: m.feeder_b_slot }
                  : {
                      kind: 'match' as const,
                      publicCode: publicCodeByMatchId.get(m.feeder_b_match_id ?? '') ?? null,
                    },
            }))
        : [];
      return {
        id: p.id,
        poolUid: p.pool_uid,
        ordinal: p.ordinal,
        isWalkover: p.is_walkover,
        metrics: p.metrics,
        explanation: p.explanation,
        members: poolMembers,
        bracket: bracket ? { ...bracket, slots: bracketSlots, matches: bracketMatches } : null,
      };
    });

    return {
      category,
      readiness: runCat?.readiness ?? 'BLOCKED',
      blockedReasons: runCat?.blocked_reasons ?? [],
      selectedStrategy: runCat?.selected_strategy ?? null,
      pools: result,
    };
  }

  private async loadEntryDisplays(
    entryIds: readonly string[],
    tournamentId: string,
  ): Promise<EntryDisplay[]> {
    const entries = await this.db.query<{ id: string; external_ref: string | null; contingent_id: string }>(
      `select id, external_ref, contingent_id from entry where id = any($1::uuid[])`,
      [entryIds],
    );
    // `registered_belt_code` (e.g. "GEUP_9") is the rule set's normalized code, not what the
    // committee wrote in the SPS -- the human wording (e.g. "Geup 9 (kuning)") only lives in
    // `rule_belt.label`, already persisted from the rule set's own belt vocabulary.
    const belts = await this.db.query<{ code: string; label: string }>(
      `select code, label from rule_belt where rule_set_id = (
         select id from rule_set where tournament_id = $1 and status = 'ACTIVE' limit 1
       )`,
      [tournamentId],
    );
    const beltLabelByCode = new Map(belts.map((b) => [b.code, b.label]));
    const contingentIds = [...new Set(entries.map((e) => e.contingent_id))];
    const contingents = contingentIds.length
      ? await this.db.query<{ id: string; name: string }>(
          `select id, name from contingent where id = any($1::uuid[])`,
          [contingentIds],
        )
      : [];
    const contingentById = new Map(contingents.map((c) => [c.id, c.name]));
    const members = await this.db.query<{ entry_id: string; position: number; athlete_id: string }>(
      `select entry_id, position, athlete_id from entry_member where entry_id = any($1::uuid[]) order by entry_id, position`,
      [entryIds],
    );
    const athleteIds = [...new Set(members.map((m) => m.athlete_id))];
    const athletes = athleteIds.length
      ? await this.db.query<{
          id: string;
          full_name: string | null;
          gender: string | null;
          registered_weight_g: number | null;
          registered_height_mm: number | null;
          registered_belt_code: string | null;
        }>(
          `select id, full_name, gender, registered_weight_g, registered_height_mm, registered_belt_code from athlete where id = any($1::uuid[])`,
          [athleteIds],
        )
      : [];
    const athleteById = new Map(athletes.map((a) => [a.id, a]));

    return entries.map((e) => {
      const memberAthletes = members
        .filter((m) => m.entry_id === e.id)
        .map((m) => athleteById.get(m.athlete_id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({
          fullName: a.full_name,
          gender: a.gender,
          weightG: a.registered_weight_g,
          heightMm: a.registered_height_mm,
          beltCode: a.registered_belt_code,
          beltLabel: a.registered_belt_code ? (beltLabelByCode.get(a.registered_belt_code) ?? null) : null,
        }));
      return {
        entryId: e.id,
        externalRef: e.external_ref,
        contingent: contingentById.get(e.contingent_id) ?? '',
        displayName:
          memberAthletes
            .map((a) => a.fullName)
            .filter(Boolean)
            .join(' / ') ||
          e.external_ref ||
          e.id,
        athletes: memberAthletes,
      };
    });
  }
}
