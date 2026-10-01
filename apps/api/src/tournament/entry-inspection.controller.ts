import type { Db } from '@bagantkd/db';
import { DISCIPLINES, ELIGIBILITY_STATUSES, ENTRY_FORMATS, GENDERS } from '@bagantkd/domain';
import { formatOperatorCategoryTitle } from '@bagantkd/export';
import type { RuleSet } from '@bagantkd/rules';
import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import { body, numOrNull, oneOf, strOrNull } from '../validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches every validation_issue that concerns entry `e`: on the entry itself, on one of its athletes, or on their source rows. */
const ISSUE_MATCH = `(
  (vi.subject_type = 'ENTRY' and vi.subject_id = e.id)
  or (vi.subject_type = 'ATHLETE' and vi.subject_id in (select em.athlete_id from entry_member em where em.entry_id = e.id))
  or (vi.subject_type = 'IMPORT_ROW' and (
        vi.subject_id = e.import_row_id
        or vi.subject_id in (select a.source_import_row_id from entry_member em join athlete a on a.id = em.athlete_id where em.entry_id = e.id)
  ))
)`;

interface EntryRow {
  id: string;
  external_ref: string | null;
  contingent: string;
  declared_stream: string;
  declared_discipline: string;
  declared_format: string;
  declared_age_division: string;
  declared_class: string | null;
  registration_status: string;
  eligibility_status: string;
  eligibility_reasons: unknown;
  category_id: string | null;
  cat_stream: string | null;
  cat_discipline: string | null;
  cat_gender: string | null;
  cat_movement: string | null;
  cat_age_code: string | null;
  cat_age_label: string | null;
  cat_weight_code: string | null;
  group_source: string | null;
  group_status: string | null;
  group_confidence: string | null;
}

interface CategoryNameRow {
  id: string;
  stream: string;
  discipline: string;
  gender: string;
  movement: string | null;
  age_code: string | null;
  age_label: string | null;
  weight_code: string | null;
}

const categoryName = (c: {
  stream: string;
  discipline: string;
  gender: string;
  movement: string | null;
  age_code: string | null;
  age_label: string | null;
  weight_code: string | null;
}): string =>
  formatOperatorCategoryTitle({
    stream: c.stream,
    discipline: c.discipline,
    gender: c.gender,
    movement: c.movement,
    ageDivisionCode: c.age_code,
    ageDivisionLabel: c.age_label,
    weightClassCode: c.weight_code,
  });

const escapeLike = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

function optionalEnum<T extends string>(
  raw: string | undefined,
  field: string,
  allowed: readonly T[],
): T | null {
  if (raw === undefined || raw === '') return null;
  if (!(allowed as readonly string[]).includes(raw))
    throw new ApiError('VALIDATION_ERROR', `${field} must be one of ${allowed.join(', ')}`);
  return raw as T;
}

function intParam(
  raw: string | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ApiError('VALIDATION_ERROR', `${field} must be an integer between ${min} and ${max}`);
  return n;
}

/**
 * `GET /tournaments/:id/entries` (AUD-009): read-only participant / entry inspection. Everything
 * shown — eligibility, registration status, blocking reasons, grouping provenance, validation
 * issues — is what intake and the draw pipeline already PERSISTED; nothing is re-derived here.
 * Never selects `athlete.nik_*`, and never selects `validation_issue.raw_value`/`suggestion`/`params`
 * either (a NIK-format issue's raw value IS the NIK) — only code, severity, status and field.
 */
@Controller('tournaments/:id')
@UseGuards(ActorGuard)
@TournamentScope('tournament', 'id')
export class EntryInspectionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('entries')
  async entries(
    @Param('id') tournamentId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<Record<string, unknown>> {
    const discipline = optionalEnum(query['discipline'], 'discipline', DISCIPLINES);
    const format = optionalEnum(query['format'], 'format', ENTRY_FORMATS);
    const eligibility = optionalEnum(query['eligibility'], 'eligibility', ELIGIBILITY_STATUSES);
    const categoryId = query['categoryId'] ?? '';
    if (categoryId !== '' && categoryId !== 'NONE' && !UUID.test(categoryId))
      throw new ApiError('VALIDATION_ERROR', 'categoryId must be a UUID or NONE');
    const hasIssues = query['hasIssues'];
    if (hasIssues !== undefined && hasIssues !== '' && hasIssues !== 'true' && hasIssues !== 'false')
      throw new ApiError('VALIDATION_ERROR', 'hasIssues must be true or false');
    const q = (query['q'] ?? '').trim();
    const contingent = (query['contingent'] ?? '').trim();
    const limit = intParam(query['limit'], 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = intParam(query['offset'], 'offset', 0, 0, 1_000_000);

    const params: unknown[] = [tournamentId];
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = ['e.tournament_id = $1'];
    if (q) {
      const p = bind(escapeLike(q));
      where.push(
        `(e.external_ref ilike ${p} or exists (select 1 from entry_member em join athlete a on a.id = em.athlete_id where em.entry_id = e.id and a.full_name ilike ${p}))`,
      );
    }
    if (contingent) where.push(`c.name ilike ${bind(escapeLike(contingent))}`);
    if (discipline) where.push(`e.declared_discipline = ${bind(discipline)}`);
    if (format) where.push(`e.declared_format = ${bind(format)}`);
    if (eligibility) where.push(`e.eligibility_status = ${bind(eligibility)}`);
    if (categoryId === 'NONE') where.push('e.category_id is null');
    else if (categoryId) where.push(`e.category_id = ${bind(categoryId)}`);
    if (hasIssues === 'true')
      // INFO-severity issues (e.g. CLASS_FORMAT_NORMALIZED) are the system noting what it already
      // silently auto-corrected, not something the committee needs to review -- "Perlu Ditinjau"
      // means ERROR/WARNING only, matching what Peserta's own "Masalah Data" column shows.
      where.push(
        `exists (select 1 from validation_issue vi where vi.tournament_id = e.tournament_id and vi.status = 'OPEN' and vi.severity != 'INFO' and ${ISSUE_MATCH})`,
      );
    const whereSql = where.join(' and ');
    const filterParams = [...params];

    const [countRow] = await this.db.query<{ n: string }>(
      `select count(*) as n from entry e join contingent c on c.id = e.contingent_id where ${whereSql}`,
      filterParams,
    );
    const total = Number(countRow?.n ?? 0);

    const rows = await this.db.query<EntryRow>(
      `select e.id, e.external_ref, c.name as contingent,
              e.declared_stream, e.declared_discipline, e.declared_format, e.declared_age_division, e.declared_class,
              e.registration_status, e.eligibility_status, e.eligibility_reasons, e.category_id,
              cat.stream as cat_stream, cat.discipline as cat_discipline, cat.gender as cat_gender, cat.movement as cat_movement,
              rad.code as cat_age_code, rad.label as cat_age_label, rwc.code as cat_weight_code,
              g.source as group_source, g.status as group_status, g.confidence as group_confidence
       from entry e
       join contingent c on c.id = e.contingent_id
       left join category cat on cat.id = e.category_id
       left join rule_age_division rad on rad.id = cat.age_division_id
       left join rule_weight_class rwc on rwc.id = cat.weight_class_id
       left join entry_group g on g.entry_id = e.id
       where ${whereSql}
       order by c.name,
                (select a.full_name from entry_member em join athlete a on a.id = em.athlete_id where em.entry_id = e.id order by em.position limit 1) nulls last,
                e.external_ref nulls last, e.id
       limit ${bind(limit)} offset ${bind(offset)}`,
      params,
    );

    const ids = rows.map((r) => r.id);
    // `registered_belt_code` (e.g. "GEUP_9") is the rule set's normalized code, not what the
    // committee wrote in the SPS -- the human wording (e.g. "Geup 9 (kuning)", the color the team
    // actually needs on the mat) only lives in `rule_belt.label`, already persisted from the rule
    // set's own belt vocabulary. Never re-derive it from the code string.
    const members = ids.length
      ? await this.db.query<{
          entry_id: string;
          position: number;
          full_name: string | null;
          gender: string | null;
          belt: string | null;
          belt_label: string | null;
          height_mm: number | null;
          weight_g: number | null;
          birth_date: string | null;
        }>(
          `select em.entry_id, em.position, a.full_name, a.gender, a.registered_belt_code as belt,
                  rb.label as belt_label,
                  a.registered_height_mm as height_mm, a.registered_weight_g as weight_g,
                  to_char(a.birth_date, 'YYYY-MM-DD') as birth_date
           from entry_member em
           join athlete a on a.id = em.athlete_id
           left join rule_belt rb on rb.code = a.registered_belt_code
             and rb.rule_set_id = (select id from rule_set where tournament_id = $2 and status = 'ACTIVE' limit 1)
           where em.entry_id = any($1::uuid[]) order by em.entry_id, em.position`,
          [ids, tournamentId],
        )
      : [];
    const issues = ids.length
      ? await this.db.query<{
          entry_id: string;
          id: string;
          code: string;
          severity: string;
          status: string;
          field: string | null;
          subject_type: string;
        }>(
          `select e.id as entry_id, vi.id, vi.code, vi.severity, vi.status, vi.field, vi.subject_type
           from entry e join validation_issue vi on vi.tournament_id = e.tournament_id and ${ISSUE_MATCH}
           where e.id = any($1::uuid[])
           order by e.id, case vi.severity when 'ERROR' then 0 when 'WARNING' then 1 else 2 end, vi.code, vi.id`,
          [ids],
        )
      : [];

    const facetRows = await this.db.query<CategoryNameRow>(
      `select cat.id, cat.stream, cat.discipline, cat.gender, cat.movement,
              rad.code as age_code, rad.label as age_label, rwc.code as weight_code
       from category cat
       left join rule_age_division rad on rad.id = cat.age_division_id
       left join rule_weight_class rwc on rwc.id = cat.weight_class_id
       where cat.id in (select category_id from entry where tournament_id = $1 and category_id is not null)`,
      [tournamentId],
    );
    const facets = facetRows
      .map((c) => ({ id: c.id, displayName: categoryName(c) }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const items = rows.map((r) => {
      const entryMembers = members
        .filter((m) => m.entry_id === r.id)
        .map((m) => ({
          position: m.position,
          fullName: m.full_name,
          gender: m.gender,
          beltCode: m.belt,
          beltLabel: m.belt_label,
          heightMm: m.height_mm,
          weightG: m.weight_g,
          birthDate: m.birth_date,
        }));
      const entryIssues = issues
        .filter((i) => i.entry_id === r.id)
        .map((i) => ({
          id: i.id,
          code: i.code,
          severity: i.severity,
          status: i.status,
          field: i.field,
          subjectType: i.subject_type,
        }));
      const open = entryIssues.filter((i) => i.status === 'OPEN');
      return {
        entryId: r.id,
        externalRef: r.external_ref,
        contingent: r.contingent,
        displayName:
          entryMembers
            .map((m) => m.fullName)
            .filter(Boolean)
            .join(' / ') ||
          r.external_ref ||
          r.id,
        format: r.declared_format,
        members: entryMembers,
        declared: {
          stream: r.declared_stream,
          discipline: r.declared_discipline,
          format: r.declared_format,
          ageDivision: r.declared_age_division,
          weightClass: r.declared_class,
        },
        category:
          r.category_id && r.cat_stream && r.cat_discipline && r.cat_gender
            ? {
                id: r.category_id,
                displayName: categoryName({
                  stream: r.cat_stream,
                  discipline: r.cat_discipline,
                  gender: r.cat_gender,
                  movement: r.cat_movement,
                  age_code: r.cat_age_code,
                  age_label: r.cat_age_label,
                  weight_code: r.cat_weight_code,
                }),
              }
            : null,
        registrationStatus: r.registration_status,
        eligibilityStatus: r.eligibility_status,
        eligibilityReasons: Array.isArray(r.eligibility_reasons)
          ? (r.eligibility_reasons as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        group: r.group_source
          ? { source: r.group_source, status: r.group_status, confidence: r.group_confidence }
          : null,
        issues: entryIssues,
        openIssueCounts: {
          error: open.filter((i) => i.severity === 'ERROR').length,
          warning: open.filter((i) => i.severity === 'WARNING').length,
          info: open.filter((i) => i.severity === 'INFO').length,
        },
      };
    });

    return { items, total, limit, offset, facets: { categories: facets } };
  }

  /**
   * The active rule set's own belt/age-division/weight-class vocabulary, trimmed to what the
   * "Perbaiki Data Peserta" dropdowns need (never hand-invented lists) -- belts ordered by `rank`
   * (Geup 9 lowest through Dan 4 highest), age divisions ordered by `order`, and weight classes kept
   * scoped by (stream, ageDivisionCode, gender) exactly as the rule set defines them, since Kyorugi
   * weight classes differ by age division and gender.
   */
  @Get('rule-set-vocabulary')
  async ruleSetVocabulary(@Param('id') tournamentId: string): Promise<{
    belts: readonly { code: string; rank: number; label: string }[];
    ageDivisions: readonly { code: string; label: string; order: number }[];
    weightClassTables: readonly {
      stream: string;
      ageDivisionCode: string;
      gender: string;
      classes: readonly { code: string }[];
    }[];
  }> {
    const [row] = await this.db.query<{ snapshot: RuleSet }>(
      `select snapshot from rule_set where tournament_id = $1 and status = 'ACTIVE' limit 1`,
      [tournamentId],
    );
    const snapshot = row?.snapshot;
    return {
      belts: [...(snapshot?.belts ?? [])].sort((a, b) => a.rank - b.rank),
      ageDivisions: [...(snapshot?.ageDivisions ?? [])].sort((a, b) => a.order - b.order),
      weightClassTables: (snapshot?.weightClassTables ?? []).map((t) => ({
        stream: t.stream,
        ageDivisionCode: t.ageDivisionCode,
        gender: t.gender,
        classes: t.classes.map((c) => ({ code: c.code })),
      })),
    };
  }

  /**
   * A minimal, direct correction for the data-quality issues the team actually hits (wrong weight,
   * unclear belt/class, a birthdate typo) -- not a general-purpose entry editor. Scoped to
   * INDIVIDUAL entries only: a Pair/Team entry has several athletes, and this form has no per-member
   * picker, so editing it here would silently change the wrong person's data. Writes straight to the
   * registered fields (never the immutable intake/import-row snapshot) and leaves re-validation to
   * the next draw run's intake snapshot -- there is no per-field re-validation pass to invoke here.
   */
  @Patch('entries/:entryId')
  async correct(
    @Param('id') tournamentId: string,
    @Param('entryId') entryId: string,
    @Body() raw: unknown,
  ): Promise<{ readonly ok: true }> {
    if (!UUID.test(entryId)) throw new ApiError('VALIDATION_ERROR', 'entryId must be a UUID');
    const b = body(raw);

    const [entry] = await this.db.query<{ format: string }>(
      `select declared_format as format from entry where id = $1 and tournament_id = $2`,
      [entryId, tournamentId],
    );
    if (!entry) throw new ApiError('VALIDATION_ERROR', 'entry not found');
    if (entry.format !== 'INDIVIDUAL')
      throw new ApiError(
        'VALIDATION_ERROR',
        'only an INDIVIDUAL entry can be corrected here (a Pair/Team entry has multiple athletes)',
      );

    const [member] = await this.db.query<{ athlete_id: string }>(
      `select athlete_id from entry_member where entry_id = $1 order by position limit 1`,
      [entryId],
    );
    if (!member) throw new ApiError('VALIDATION_ERROR', 'entry has no athlete to correct');

    const fullName = strOrNull(b, 'fullName');
    const gender = b['gender'] === undefined || b['gender'] === null ? null : oneOf(b, 'gender', GENDERS);
    const birthDate = strOrNull(b, 'birthDate');
    const heightMm = numOrNull(b, 'heightMm');
    const weightG = numOrNull(b, 'weightG');
    const beltCode = strOrNull(b, 'beltCode');
    const declaredAgeDivision = strOrNull(b, 'declaredAgeDivision');
    const declaredClass = strOrNull(b, 'declaredClass');
    const contingentName = strOrNull(b, 'contingent');

    await this.db.transaction(async (tx) => {
      await tx.query(
        `update athlete set
           full_name = coalesce($1, full_name),
           gender = coalesce($2, gender),
           birth_date = coalesce($3::date, birth_date),
           registered_height_mm = coalesce($4, registered_height_mm),
           registered_weight_g = coalesce($5, registered_weight_g),
           registered_belt_code = coalesce($6, registered_belt_code)
         where id = $7`,
        [fullName, gender, birthDate, heightMm, weightG, beltCode, member.athlete_id],
      );
      if (declaredAgeDivision !== null || declaredClass !== null) {
        await tx.query(
          `update entry set
             declared_age_division = coalesce($1, declared_age_division),
             declared_class = coalesce($2, declared_class)
           where id = $3`,
          [declaredAgeDivision, declaredClass, entryId],
        );
      }
      if (contingentName !== null) {
        // Re-points THIS entry to the (existing or newly created) contingent of that name --
        // never renames the entry's current contingent row, so other entries under it are
        // untouched. Reuses an existing row when the name already exists (contingent_name_uq).
        const [c] = await tx.query<{ id: string }>(
          `insert into contingent (tournament_id, name) values ($1, $2)
           on conflict (tournament_id, name) do update set name = excluded.name
           returning id`,
          [tournamentId, contingentName],
        );
        await tx.query(`update entry set contingent_id = $1 where id = $2`, [c?.id, entryId]);
      }
    });

    return { ok: true };
  }
}
