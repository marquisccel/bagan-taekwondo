import type { RuleSet } from '@bagantkd/rules';
import { fingerprint } from '@bagantkd/shared';

import type { SqlExecutor } from './intake-repository.js';

/**
 * Persists a rule-set JSON (the same object the frozen engine consumes) into the relational
 * `rule_*` tables (Phase 2 U-11 / Phase 4 U-P3-04), then activates it: `rule_set.snapshot` is the
 * canonical JSON and `rule_set.fingerprint` matches what the engine computes from the same object,
 * so a `draw_run.rules_fingerprint` can be checked against either representation.
 *
 * The relational tables exist for querying/admin (list templates, weight classes, …); the engine
 * itself is always fed the JSON snapshot, never reconstructed from these rows.
 */
export interface PersistedRuleSet {
  readonly ruleSetId: string;
  readonly fingerprint: string;
  readonly templateIdByCode: ReadonlyMap<string, string>;
  readonly ageDivisionIdByCode: ReadonlyMap<string, string>;
  /** Key: `${stream}|${ageDivisionCode}|${gender}|${classCode}`. */
  readonly weightClassIdByKey: ReadonlyMap<string, string>;
}

const pgArray = (values: readonly string[] | null): string | null =>
  values === null ? null : `{${values.join(',')}}`;

const one = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new Error('INSERT ... RETURNING produced no row');
  return row;
};

export async function persistRuleSet(
  tx: SqlExecutor,
  args: { readonly tournamentId: string; readonly actorId: string; readonly ruleSet: RuleSet },
): Promise<PersistedRuleSet> {
  const rs = args.ruleSet;
  const { next } = one(
    await tx.query<{ next: number }>(
      `select coalesce(max(version), 0) + 1 as next from rule_set where tournament_id = $1`,
      [args.tournamentId],
    ),
  );
  const { id: ruleSetId } = one(
    await tx.query<{ id: string }>(
      `insert into rule_set (tournament_id, code, version, name, age_policy, age_reference_year, age_cutoff_date, age_provenance, plausibility, source_vocabulary, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11) returning id`,
      [
        args.tournamentId,
        rs.code,
        next,
        rs.name,
        rs.age.policy,
        rs.age.referenceYear,
        rs.age.cutoffDate,
        JSON.stringify(rs.age.provenance),
        JSON.stringify(rs.plausibility),
        JSON.stringify(rs.sourceVocabulary),
        args.actorId,
      ],
    ),
  );

  const ageDivisionIdByCode = new Map<string, string>();
  for (const d of rs.ageDivisions) {
    const { id } = one(
      await tx.query<{ id: string }>(
        `insert into rule_age_division (rule_set_id, code, label, streams, min_birth_year, max_birth_year, ord, play_up_policy, provenance)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) returning id`,
        [
          ruleSetId,
          d.code,
          d.label,
          pgArray(d.streams),
          d.minBirthYear,
          d.maxBirthYear,
          d.order,
          d.playUp,
          JSON.stringify(d.provenance),
        ],
      ),
    );
    ageDivisionIdByCode.set(d.code, id);
  }

  const beltIdByCode = new Map<string, string>();
  for (const b of rs.belts) {
    const { id } = one(
      await tx.query<{ id: string }>(
        `insert into rule_belt (rule_set_id, code, rank, label, source_labels) values ($1, $2, $3, $4, $5) returning id`,
        [ruleSetId, b.code, b.rank, b.label, pgArray(b.sourceLabels)],
      ),
    );
    beltIdByCode.set(b.code, id);
  }

  const schemeIdByCode = new Map<string, string>();
  const bandIdByKey = new Map<string, string>(); // `${schemeCode}|${bandCode}`
  for (const s of rs.beltBandSchemes) {
    const { id: schemeId } = one(
      await tx.query<{ id: string }>(
        `insert into rule_belt_band_scheme (rule_set_id, code, purpose, provenance) values ($1, $2, $3, $4::jsonb) returning id`,
        [ruleSetId, s.code, s.purpose, JSON.stringify(s.provenance)],
      ),
    );
    schemeIdByCode.set(s.code, schemeId);
    for (const band of s.bands) {
      const { id: bandId } = one(
        await tx.query<{ id: string }>(
          `insert into rule_belt_band (scheme_id, code, label) values ($1, $2, $3) returning id`,
          [schemeId, band.code, band.label],
        ),
      );
      bandIdByKey.set(`${s.code}|${band.code}`, bandId);
      for (const beltCode of band.beltCodes) {
        const beltId = beltIdByCode.get(beltCode);
        if (!beltId) throw new Error(`unknown belt code ${beltCode} in band ${band.code}`);
        await tx.query(
          `insert into rule_belt_band_member (band_id, scheme_id, belt_id) values ($1, $2, $3)`,
          [bandId, schemeId, beltId],
        );
      }
    }
  }

  const movementMapIdByCode = new Map<string, string>();
  for (const m of rs.movementMaps) {
    const schemeId = schemeIdByCode.get(m.schemeCode);
    if (!schemeId) throw new Error(`unknown belt band scheme ${m.schemeCode} for movement map ${m.code}`);
    const { id: mapId } = one(
      await tx.query<{ id: string }>(
        `insert into rule_movement_map (rule_set_id, code, scheme_id, provenance) values ($1, $2, $3, $4::jsonb) returning id`,
        [ruleSetId, m.code, schemeId, JSON.stringify(m.provenance)],
      ),
    );
    movementMapIdByCode.set(m.code, mapId);
    for (const e of m.entries) {
      const bandId = bandIdByKey.get(`${m.schemeCode}|${e.bandCode}`);
      if (!bandId) throw new Error(`unknown band ${e.bandCode} in scheme ${m.schemeCode}`);
      await tx.query(`insert into rule_movement_map_entry (map_id, band_id, movement) values ($1, $2, $3)`, [
        mapId,
        bandId,
        e.movement,
      ]);
    }
  }

  const weightClassIdByKey = new Map<string, string>();
  for (const wt of rs.weightClassTables) {
    const ageDivisionId = ageDivisionIdByCode.get(wt.ageDivisionCode);
    if (!ageDivisionId) throw new Error(`unknown age division ${wt.ageDivisionCode} in weight class table`);
    const { id: tableId } = one(
      await tx.query<{ id: string }>(
        `insert into rule_weight_class_table (rule_set_id, stream, age_division_id, gender, completeness, provenance)
         values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
        [ruleSetId, wt.stream, ageDivisionId, wt.gender, wt.completeness, JSON.stringify(wt.provenance)],
      ),
    );
    for (const [i, c] of wt.classes.entries()) {
      const { id: classId } = one(
        await tx.query<{ id: string }>(
          `insert into rule_weight_class (table_id, code, lower_exclusive_g, upper_inclusive_g, ord) values ($1, $2, $3, $4, $5) returning id`,
          [tableId, c.code, c.lowerExclusiveG, c.upperInclusiveG, i + 1],
        ),
      );
      weightClassIdByKey.set(`${wt.stream}|${wt.ageDivisionCode}|${wt.gender}|${c.code}`, classId);
    }
  }

  const poolPolicyIdByCode = new Map<string, string>();
  for (const p of rs.poolPolicies) {
    const beltSchemeId = p.belt.schemeCode ? (schemeIdByCode.get(p.belt.schemeCode) ?? null) : null;
    const { id: policyId } = one(
      await tx.query<{ id: string }>(
        `insert into rule_pool_policy (rule_set_id, code, pool_min, pool_target, pool_max, size_penalty_provenance, belt_policy, belt_scheme_id, belt_provenance, tier1_slack_fp, contingent_weight_permille, bracket_weight_permille, tiers_provenance, singleton_policy, singleton_provenance, measurement_source, contingent_key, local_search_budget_per_entry)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17,$18) returning id`,
        [
          ruleSetId,
          p.code,
          p.poolMin,
          p.poolTarget,
          p.poolMax,
          JSON.stringify(p.sizePenaltyProvenance),
          p.belt.policy,
          beltSchemeId,
          JSON.stringify(p.belt.provenance),
          p.tiers.tier1SlackFp,
          p.tiers.contingentWeightPermille,
          p.tiers.bracketWeightPermille,
          JSON.stringify(p.tiers.provenance),
          p.singleton.policy,
          JSON.stringify(p.singleton.provenance),
          p.measurementSource,
          p.contingentKey,
          p.localSearchBudgetPerEntry,
        ],
      ),
    );
    poolPolicyIdByCode.set(p.code, policyId);
    for (const [size, penaltyFp] of Object.entries(p.sizePenaltyFp)) {
      await tx.query(`insert into rule_pool_size_penalty (policy_id, size, penalty_fp) values ($1, $2, $3)`, [
        policyId,
        Number(size),
        penaltyFp,
      ]);
    }
    for (const t of p.tolerances) {
      const ageDivisionId = t.ageDivisionCode ? (ageDivisionIdByCode.get(t.ageDivisionCode) ?? null) : null;
      await tx.query(
        `insert into rule_tolerance (policy_id, dimension, age_division_id, active, ideal, ideal_provenance, max_status, max_value, max_provenance, linear_weight_permille, overflow_weight_permille)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11)`,
        [
          policyId,
          t.dimension,
          ageDivisionId,
          t.active,
          t.ideal,
          JSON.stringify(t.idealProvenance),
          t.max.status,
          t.max.status === 'SET' ? t.max.value : null,
          t.max.status === 'UNSET' ? null : JSON.stringify(t.max.provenance),
          t.linearWeightPermille,
          t.overflowWeightPermille,
        ],
      );
    }
  }

  for (const c of rs.composition) {
    await tx.query(
      `insert into rule_composition (rule_set_id, format, size, genders) values ($1, $2, $3, $4)`,
      [ruleSetId, c.format, c.size, pgArray(c.genders)],
    );
  }

  const templateIdByCode = new Map<string, string>();
  for (const t of rs.categoryTemplates) {
    const poolPolicyId = t.poolPolicyCode ? (poolPolicyIdByCode.get(t.poolPolicyCode) ?? null) : null;
    const movementMapId = t.movementMapCode ? (movementMapIdByCode.get(t.movementMapCode) ?? null) : null;
    const { id: templateId } = one(
      await tx.query<{ id: string }>(
        `insert into rule_category_template (rule_set_id, code, stream, discipline, format, gender_mode, dimensions, draw_format, pool_policy_id, movement_map_id, bye_policy, bronze_medals, provenance)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) returning id`,
        [
          ruleSetId,
          t.code,
          t.stream,
          t.discipline,
          t.format,
          t.genderMode,
          pgArray(t.dimensions),
          t.drawFormat,
          poolPolicyId,
          movementMapId,
          t.byePolicy,
          t.bronzeMedals,
          JSON.stringify(t.provenance),
        ],
      ),
    );
    templateIdByCode.set(t.code, templateId);
  }

  const fp = fingerprint(rs);
  await tx.query(
    `update rule_set set status = 'ACTIVE', snapshot = $2::jsonb, fingerprint = $3, activated_at = now() where id = $1`,
    [ruleSetId, JSON.stringify(rs), fp],
  );

  return { ruleSetId, fingerprint: fp, templateIdByCode, ageDivisionIdByCode, weightClassIdByKey };
}
