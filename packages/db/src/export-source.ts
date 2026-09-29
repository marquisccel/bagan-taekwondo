import {
  buildExportModel,
  type ExportModel,
  type RawBracketRow,
  type RawBracketSlotRow,
  type RawCategoryRow,
  type RawEntryRow,
  type RawMatchRow,
  type RawPoolMemberRow,
  type RawPoolRow,
  type ScheduleSlot,
} from '@bagantkd/export';
import { parseWeightClass, vocabularyKey } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { categoryKeyDims, DomainError } from '@bagantkd/shared';

import type { Db } from './db.js';

/**
 * DB read -> canonical ExportModel (Phase 6 ACCEPTANCE §3). This is the ONLY place export code
 * queries the database; PDF and XLSX renderers never see a `Db` handle. Field selection here
 * mirrors `apps/api/src/revision/revision-read.controller.ts`'s `loadEntryDisplays` exactly — never
 * `athlete.nik_ciphertext` / `nik_blind_index`.
 */
export async function loadExportModel(db: Db, revisionId: string): Promise<ExportModel> {
  const [revision] = await db.query<{
    id: string;
    revision_no: number;
    lifecycle: string;
    content_fingerprint: string | null;
    submitted_at: Date | null;
    approved_at: Date | null;
    locked_at: Date | null;
    published_at: Date | null;
    draw_run_id: string;
    tournament_id: string;
  }>(
    `select id, revision_no, lifecycle, content_fingerprint, submitted_at, approved_at, locked_at, published_at,
            draw_run_id, tournament_id
     from draw_revision where id = $1`,
    [revisionId],
  );
  if (!revision) throw new DomainError('REVISION_NOT_FOUND', { revisionId });

  const [drawRun] = await db.query<{ rule_set_id: string }>(
    `select rule_set_id from draw_run where id = $1`,
    [revision.draw_run_id],
  );
  const ruleSetId = drawRun?.rule_set_id ?? null;

  const [tournament] = await db.query<{
    id: string;
    code: string;
    name: string;
    event_start: string;
    event_end: string;
  }>(
    `select id, code, name, to_char(event_start, 'YYYY-MM-DD') as event_start,
            to_char(event_end, 'YYYY-MM-DD') as event_end
     from tournament where id = $1`,
    [revision.tournament_id],
  );
  if (!tournament) throw new DomainError('TOURNAMENT_NOT_FOUND', { tournamentId: revision.tournament_id });

  const [quality] = await db.query<{
    error_count: number;
    warning_count: number;
    info_count: number;
    report: { findings?: readonly { level: 'ERROR' | 'WARNING' | 'INFO'; code: string; subject: string }[] };
  }>(`select error_count, warning_count, info_count, report from quality_report where draw_run_id = $1`, [
    revision.draw_run_id,
  ]);

  const categoryRows = await db.query<{
    category_id: string;
    category_key: string;
    stream: string;
    discipline: string;
    format: string;
    gender: string;
    movement: string | null;
    age_division_code: string | null;
    age_division_label: string | null;
    weight_class_code: string | null;
    readiness: string;
  }>(
    `select rc.category_id, c.category_key, c.stream, c.discipline, c.format, c.gender, c.movement,
            rad.code as age_division_code, rad.label as age_division_label,
            rwc.code as weight_class_code, rc.readiness
     from draw_run_category rc
     join category c on c.id = rc.category_id
     join rule_age_division rad on rad.id = c.age_division_id
     left join rule_weight_class rwc on rwc.id = c.weight_class_id
     where rc.draw_run_id = $1
     order by c.category_key`,
    [revision.draw_run_id],
  );
  const categories: RawCategoryRow[] = categoryRows.map((c) => ({
    id: c.category_id,
    categoryKey: c.category_key,
    stream: c.stream,
    discipline: c.discipline,
    format: c.format,
    gender: c.gender,
    movement: c.movement,
    ageDivisionCode: c.age_division_code,
    ageDivisionLabel: c.age_division_label,
    weightClassCode: c.weight_class_code,
    readiness: c.readiness,
  }));
  const categoryIds = categories.map((c) => c.id);

  const poolRows = categoryIds.length
    ? await db.query<{
        id: string;
        category_id: string;
        pool_uid: string;
        ordinal: number;
        is_walkover: boolean;
        explanation: unknown;
      }>(
        `select id, category_id, pool_uid, ordinal, is_walkover, explanation
         from pool where revision_id = $1 and category_id = any($2::uuid[]) order by ordinal`,
        [revisionId, categoryIds],
      )
    : [];
  const pools: RawPoolRow[] = poolRows.map((p) => ({
    id: p.id,
    categoryId: p.category_id,
    poolUid: p.pool_uid,
    ordinal: p.ordinal,
    isWalkover: p.is_walkover,
    warnings: Array.isArray(p.explanation)
      ? (p.explanation as readonly { message?: string; code?: string }[]).map(
          (e) => e.message ?? e.code ?? '',
        )
      : [],
  }));
  const poolIds = pools.map((p) => p.id);

  const poolMemberRows = poolIds.length
    ? await db.query<{ pool_id: string; entry_id: string }>(
        `select pool_id, entry_id from pool_member where pool_id = any($1::uuid[])`,
        [poolIds],
      )
    : [];
  const poolMembers: RawPoolMemberRow[] = poolMemberRows.map((m) => ({
    poolId: m.pool_id,
    entryId: m.entry_id,
  }));

  const entryIds = [...new Set(poolMemberRows.map((m) => m.entry_id))];
  const entries: RawEntryRow[] = entryIds.length ? await loadEntryDisplays(db, entryIds, ruleSetId) : [];

  const bracketRows = poolIds.length
    ? await db.query<{
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
  const brackets: RawBracketRow[] = bracketRows.map((b) => ({
    id: b.id,
    poolId: b.pool_id,
    size: b.size,
    rounds: b.rounds,
    entries: b.entries,
    byes: b.byes,
  }));
  const bracketIds = brackets.map((b) => b.id);

  const slotRows = bracketIds.length
    ? await db.query<{
        bracket_id: string;
        position: number;
        seed_no: number | null;
        entry_id: string | null;
      }>(
        `select bracket_id, position, seed_no, entry_id from bracket_slot where bracket_id = any($1::uuid[])`,
        [bracketIds],
      )
    : [];
  const bracketSlots: RawBracketSlotRow[] = slotRows.map((s) => ({
    bracketId: s.bracket_id,
    position: s.position,
    seedNo: s.seed_no,
    entryId: s.entry_id,
  }));

  const matchRows = bracketIds.length
    ? await db.query<{
        id: string;
        bracket_id: string;
        match_uid: string;
        public_code: string | null;
        round: number;
        position: number;
        status: string;
        feeder_a_slot: number | null;
        feeder_a_match_id: string | null;
        feeder_b_slot: number | null;
        feeder_b_match_id: string | null;
        display_no: number | null;
      }>(
        `select id, bracket_id, match_uid, public_code, round, position, status,
                feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, display_no
         from match where bracket_id = any($1::uuid[])`,
        [bracketIds],
      )
    : [];
  const matches: RawMatchRow[] = matchRows.map((m) => ({
    id: m.id,
    bracketId: m.bracket_id,
    matchUid: m.match_uid,
    publicCode: m.public_code,
    round: m.round,
    position: m.position,
    status: m.status,
    feederASlot: m.feeder_a_slot,
    feederAMatchId: m.feeder_a_match_id,
    feederBSlot: m.feeder_b_slot,
    feederBMatchId: m.feeder_b_match_id,
    displayNo: m.display_no,
  }));

  return buildExportModel({
    tournament: {
      id: tournament.id,
      code: tournament.code,
      name: tournament.name,
      eventStart: tournament.event_start,
      eventEnd: tournament.event_end,
    },
    revision: {
      id: revision.id,
      revisionNo: revision.revision_no,
      lifecycle: revision.lifecycle,
      contentFingerprint: revision.content_fingerprint,
      submittedAt: revision.submitted_at?.toISOString() ?? null,
      approvedAt: revision.approved_at?.toISOString() ?? null,
      lockedAt: revision.locked_at?.toISOString() ?? null,
      publishedAt: revision.published_at?.toISOString() ?? null,
    },
    quality: quality
      ? {
          errorCount: quality.error_count,
          warningCount: quality.warning_count,
          infoCount: quality.info_count,
          findings: [...(quality.report.findings ?? [])].sort(
            (a, b) => a.level.localeCompare(b.level) || a.code.localeCompare(b.code),
          ),
        }
      : null,
    categories,
    pools,
    poolMembers,
    entries,
    brackets,
    bracketSlots,
    matches,
  });
}

async function loadEntryDisplays(
  db: Db,
  entryIds: readonly string[],
  ruleSetId: string | null,
): Promise<RawEntryRow[]> {
  const entries = await db.query<{ id: string; external_ref: string | null; contingent_id: string }>(
    `select id, external_ref, contingent_id from entry where id = any($1::uuid[])`,
    [entryIds],
  );
  const contingentIds = [...new Set(entries.map((e) => e.contingent_id))];
  const contingents = contingentIds.length
    ? await db.query<{ id: string; name: string }>(
        `select id, name from contingent where id = any($1::uuid[])`,
        [contingentIds],
      )
    : [];
  const contingentById = new Map(contingents.map((c) => [c.id, c.name]));
  const members = await db.query<{ entry_id: string; position: number; athlete_id: string }>(
    `select entry_id, position, athlete_id from entry_member where entry_id = any($1::uuid[]) order by entry_id, position`,
    [entryIds],
  );
  const athleteIds = [...new Set(members.map((m) => m.athlete_id))];
  const athletes = athleteIds.length
    ? await db.query<{
        id: string;
        full_name: string | null;
        gender: string | null;
        registered_weight_g: number | null;
        registered_height_mm: number | null;
        registered_belt_code: string | null;
      }>(
        `select id, full_name, gender, registered_weight_g, registered_height_mm, registered_belt_code
         from athlete where id = any($1::uuid[])`,
        [athleteIds],
      )
    : [];
  const athleteById = new Map(athletes.map((a) => [a.id, a]));

  const beltCodes = [...new Set(athletes.map((a) => a.registered_belt_code).filter((c): c is string => !!c))];
  const beltLabelByCode =
    ruleSetId && beltCodes.length
      ? new Map(
          (
            await db.query<{ code: string; label: string }>(
              `select code, label from rule_belt where rule_set_id = $1 and code = any($2::text[])`,
              [ruleSetId, beltCodes],
            )
          ).map((b) => [b.code, b.label]),
        )
      : new Map<string, string>();

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
      id: e.id,
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

/**
 * `schedule_entry.weight_class_or_format` is the "Jadwal FIX" sheet's raw 4th-column cell text,
 * trimmed only -- the SPS ingestion path (packages/intake/src/sps-workbook.ts) deliberately never
 * canonicalizes it, unlike a category's own `WEIGHT_CLASS=`/`FORMAT=` dimension, which is always
 * either a canonical `-NN`/`+NN` weight code (`parseWeightClass`) or one of the three fixed
 * `EntryFormat` literals (via `rs.sourceVocabulary.format`). Comparing the two directly as strings
 * silently matches nothing whenever the committee's sheet isn't already in that exact canonical
 * form (a Unicode minus, a spreadsheet `=+45` leftover, a trailing `+`, or an Indonesian format
 * label like "Perorangan" instead of "INDIVIDUAL") -- so this mirrors the same normalization the
 * real intake pipeline applies before comparing.
 */
function normalizeScheduleWeightOrFormat(
  discipline: string,
  raw: string,
  formatVocabulary: Readonly<Record<string, string>>,
): string {
  if (discipline === 'KYORUGI') {
    const parsed = parseWeightClass(raw);
    return parsed.kind === 'CANONICAL' ? parsed.code : raw;
  }
  const entry = Object.entries(formatVocabulary).find(([k]) => vocabularyKey(k) === vocabularyKey(raw));
  return entry ? entry[1] : raw;
}

/**
 * The committee's arena/day "Jadwal FIX" slot (schedule_entry) that a draw run's categories belong
 * to, or `null` when the run isn't tied to one -- e.g. a draw made without going through "Jadwal &
 * Buat Bagan"'s per-slot flow. `draw_run` itself never stores which slot it was generated for, so
 * this is inferred: take the run's own categories, find any one of them in `schedule_entry` (a
 * well-formed schedule places a category in exactly one slot), then load that whole slot in the
 * committee's own row order (`order_index`) -- never just the run's own categories, since the arena/
 * day document must show every category scheduled there, drawn or not.
 */
export async function loadScheduleSlotForDrawRun(
  db: Db,
  tournamentId: string,
  drawRunId: string,
): Promise<ScheduleSlot | null> {
  const categoryRows = await db.query<{ category_key: string; stream: string; discipline: string; gender: string }>(
    `select c.category_key, c.stream, c.discipline, c.gender
     from draw_run_category rc join category c on c.id = rc.category_id
     where rc.draw_run_id = $1`,
    [drawRunId],
  );
  if (categoryRows.length === 0) return null;

  const [ruleSetRow] = await db.query<{ snapshot: RuleSet }>(
    `select snapshot from rule_set where tournament_id = $1 and status = 'ACTIVE' limit 1`,
    [tournamentId],
  );
  const formatVocabulary = ruleSetRow?.snapshot?.sourceVocabulary?.format ?? {};

  let match: { day_number: number; date: string; arena_code: string } | null = null;
  for (const c of categoryRows) {
    const dims = categoryKeyDims(c.category_key);
    const ageDivisionCode = dims.get('AGE_DIVISION') ?? '';
    const weightClassOrFormat = dims.get('WEIGHT_CLASS') ?? dims.get('FORMAT') ?? '';
    const candidates = await db.query<{
      day_number: number;
      date: string;
      arena_code: string;
      weight_class_or_format: string;
    }>(
      `select se.day_number, se.date, a.code as arena_code, se.weight_class_or_format
       from schedule_entry se join arena a on a.id = se.arena_id
       where se.tournament_id = $1 and se.stream = $2 and se.discipline = $3 and se.gender = $4
         and se.age_division_code = $5`,
      [tournamentId, c.stream, c.discipline, c.gender, ageDivisionCode],
    );
    const found = candidates.find(
      (row) =>
        normalizeScheduleWeightOrFormat(c.discipline, row.weight_class_or_format, formatVocabulary) ===
        weightClassOrFormat,
    );
    if (found) {
      match = found;
      break;
    }
  }
  if (!match) return null;

  const slotRows = await db.query<{
    stream: string;
    discipline: string;
    gender: string;
    age_division_code: string;
    weight_class_or_format: string;
  }>(
    `select se.stream, se.discipline, se.gender, se.age_division_code, se.weight_class_or_format
     from schedule_entry se join arena a on a.id = se.arena_id
     where se.tournament_id = $1 and se.day_number = $2 and a.code = $3
     order by se.order_index`,
    [tournamentId, match.day_number, match.arena_code],
  );

  const dayLabel = new Date(`${match.date}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    dayNumber: match.day_number,
    dayLabel,
    arena: `ARENA ${match.arena_code}`,
    categories: slotRows.map((r) => ({
      discipline: r.discipline,
      gender: r.gender,
      ageDivisionCode: r.age_division_code || null,
      weightClassCode:
        normalizeScheduleWeightOrFormat(r.discipline, r.weight_class_or_format, formatVocabulary) || null,
    })),
  };
}
