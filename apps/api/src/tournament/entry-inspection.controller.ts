import type { Db } from '@bagantkd/db';
import { DISCIPLINES, ELIGIBILITY_STATUSES, ENTRY_FORMATS } from '@bagantkd/domain';
import { formatCategoryDisplayName } from '@bagantkd/export';
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { ActorGuard } from '../auth/actor.guard';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

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
  formatCategoryDisplayName({
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
      where.push(
        `exists (select 1 from validation_issue vi where vi.tournament_id = e.tournament_id and vi.status = 'OPEN' and ${ISSUE_MATCH})`,
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
    const members = ids.length
      ? await this.db.query<{
          entry_id: string;
          position: number;
          full_name: string | null;
          gender: string | null;
          belt: string | null;
        }>(
          `select em.entry_id, em.position, a.full_name, a.gender, a.registered_belt_code as belt
           from entry_member em join athlete a on a.id = em.athlete_id
           where em.entry_id = any($1::uuid[]) order by em.entry_id, em.position`,
          [ids],
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
        .map((m) => ({ position: m.position, fullName: m.full_name, gender: m.gender, beltCode: m.belt }));
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
}
