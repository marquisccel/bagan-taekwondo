import { compareStrings, fingerprint, sortedBy, type Fingerprint } from '@bagantkd/shared';

import { ruleSetSchema, type PoolPolicy, type RuleSet } from './schema.js';

/**
 * What the rule set is about to be used for. Readiness is purpose-specific (ADR-0007):
 * an incomplete rule set may still drive simulations and candidate draws, but never a lock.
 */
export type RuleSetPurpose = 'SIMULATION' | 'CANDIDATE' | 'LOCK';

/**
 * INVALID       — structurally broken; unusable for any purpose.
 * LOCK_BLOCKER  — usable for simulation/candidate; LOCK and PUBLISH refused.
 * LOCK_WARNING  — LOCK allowed only after a Technical Delegate acknowledges it.
 * INFO          — recorded in reports.
 */
export type FindingLevel = 'INVALID' | 'LOCK_BLOCKER' | 'LOCK_WARNING' | 'INFO';

export interface RuleSetFinding {
  readonly code: string;
  readonly level: FindingLevel;
  readonly path: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RuleSetAssessment {
  readonly purpose: RuleSetPurpose;
  readonly allowed: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly ruleSet: RuleSet | null;
  readonly fingerprint: Fingerprint | null;
  readonly findings: readonly RuleSetFinding[];
}

export function assessRuleSet(input: unknown, purpose: RuleSetPurpose): RuleSetAssessment {
  const parsed = ruleSetSchema.safeParse(input);
  if (!parsed.success) {
    const findings = parsed.error.issues.map<RuleSetFinding>((i) => ({
      code: 'SCHEMA_VIOLATION',
      level: 'INVALID',
      path: `$${i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('')}`,
      params: { message: i.message },
    }));
    return {
      purpose,
      allowed: false,
      requiresAcknowledgement: false,
      ruleSet: null,
      fingerprint: null,
      findings,
    };
  }
  const ruleSet = parsed.data;
  const findings = sortFindings([...structuralFindings(ruleSet), ...lockFindings(ruleSet)]);
  const invalid = findings.some((f) => f.level === 'INVALID');
  const blocked = purpose === 'LOCK' && findings.some((f) => f.level === 'LOCK_BLOCKER');
  return {
    purpose,
    allowed: !invalid && !blocked,
    requiresAcknowledgement: purpose === 'LOCK' && findings.some((f) => f.level === 'LOCK_WARNING'),
    ruleSet,
    fingerprint: fingerprint(ruleSet),
    findings,
  };
}

function sortFindings(findings: RuleSetFinding[]): RuleSetFinding[] {
  const levelOrder: Record<FindingLevel, number> = { INVALID: 0, LOCK_BLOCKER: 1, LOCK_WARNING: 2, INFO: 3 };
  return sortedBy(findings, (a, b) =>
    levelOrder[a.level] !== levelOrder[b.level]
      ? levelOrder[a.level] - levelOrder[b.level]
      : compareStrings(a.path, b.path) || compareStrings(a.code, b.code),
  );
}

// ---------------------------------------------------------------------------------------
// Structural integrity: references resolve, tables are contiguous, bounds are coherent.
// ---------------------------------------------------------------------------------------

function structuralFindings(rs: RuleSet): RuleSetFinding[] {
  const out: RuleSetFinding[] = [];
  const add = (code: string, path: string, params: RuleSetFinding['params'] = {}) =>
    out.push({ code, level: 'INVALID', path, params });

  duplicates(rs.ageDivisions.map((d) => d.code)).forEach((c) =>
    add('DUPLICATE_CODE', '$.ageDivisions', { code: c }),
  );
  duplicates(rs.belts.map((b) => b.code)).forEach((c) => add('DUPLICATE_CODE', '$.belts', { code: c }));
  duplicates(rs.belts.map((b) => String(b.rank))).forEach((r) =>
    add('DUPLICATE_BELT_RANK', '$.belts', { rank: r }),
  );
  duplicates(rs.belts.flatMap((b) => b.sourceLabels)).forEach((l) =>
    add('DUPLICATE_SOURCE_LABEL', '$.belts', { label: l }),
  );
  duplicates(rs.beltBandSchemes.map((s) => s.code)).forEach((c) =>
    add('DUPLICATE_CODE', '$.beltBandSchemes', { code: c }),
  );
  duplicates(rs.movementMaps.map((m) => m.code)).forEach((c) =>
    add('DUPLICATE_CODE', '$.movementMaps', { code: c }),
  );
  duplicates(rs.poolPolicies.map((p) => p.code)).forEach((c) =>
    add('DUPLICATE_CODE', '$.poolPolicies', { code: c }),
  );
  duplicates(rs.categoryTemplates.map((t) => t.code)).forEach((c) =>
    add('DUPLICATE_CODE', '$.categoryTemplates', { code: c }),
  );
  duplicates(rs.categoryTemplates.map((t) => `${t.stream}|${t.discipline}|${t.format}`)).forEach((k) =>
    add('DUPLICATE_TEMPLATE_SCOPE', '$.categoryTemplates', { scope: k }),
  );
  duplicates(rs.composition.map((c) => c.format)).forEach((f) =>
    add('DUPLICATE_COMPOSITION', '$.composition', { format: f }),
  );

  if (rs.tournament.eventStart > rs.tournament.eventEnd) add('EVENT_DATES_INVERTED', '$.tournament');
  if (rs.age.policy === 'BIRTH_YEAR' && rs.age.referenceYear === null)
    add('AGE_REFERENCE_YEAR_REQUIRED', '$.age');
  if (rs.age.policy === 'AGE_ON_CUTOFF_DATE' && rs.age.cutoffDate === null)
    add('AGE_CUTOFF_DATE_REQUIRED', '$.age');
  const p = rs.plausibility;
  if (
    p.heightMm.min >= p.heightMm.max ||
    p.weightG.min >= p.weightG.max ||
    p.bmiTenths.min >= p.bmiTenths.max
  ) {
    add('PLAUSIBILITY_RANGE_INVERTED', '$.plausibility');
  }

  const divisions = new Map(rs.ageDivisions.map((d) => [d.code, d]));
  rs.ageDivisions.forEach((d, i) => {
    if (d.minBirthYear > d.maxBirthYear)
      add('BIRTH_YEAR_RANGE_INVERTED', `$.ageDivisions[${i}]`, { code: d.code });
  });

  const beltCodes = new Set(rs.belts.map((b) => b.code));
  const schemes = new Map(rs.beltBandSchemes.map((s) => [s.code, s]));
  rs.beltBandSchemes.forEach((s, i) => {
    const members = s.bands.flatMap((b) => b.beltCodes);
    members
      .filter((b) => !beltCodes.has(b))
      .forEach((b) => add('UNKNOWN_BELT_REF', `$.beltBandSchemes[${i}]`, { belt: b }));
    duplicates(members).forEach((b) => add('BELT_IN_MULTIPLE_BANDS', `$.beltBandSchemes[${i}]`, { belt: b }));
    duplicates(s.bands.map((b) => b.code)).forEach((c) =>
      add('DUPLICATE_CODE', `$.beltBandSchemes[${i}].bands`, { code: c }),
    );
  });

  const maps = new Map(rs.movementMaps.map((m) => [m.code, m]));
  rs.movementMaps.forEach((m, i) => {
    const scheme = schemes.get(m.schemeCode);
    if (!scheme) {
      add('UNKNOWN_SCHEME_REF', `$.movementMaps[${i}]`, { scheme: m.schemeCode });
      return;
    }
    const bandCodes = scheme.bands.map((b) => b.code);
    const mapped = m.entries.map((e) => e.bandCode);
    mapped
      .filter((b) => !bandCodes.includes(b))
      .forEach((b) => add('UNKNOWN_BAND_REF', `$.movementMaps[${i}]`, { band: b }));
    bandCodes
      .filter((b) => !mapped.includes(b))
      .forEach((b) => add('BAND_WITHOUT_MOVEMENT', `$.movementMaps[${i}]`, { band: b }));
    duplicates(mapped).forEach((b) => add('BAND_MAPPED_TWICE', `$.movementMaps[${i}]`, { band: b }));
  });

  duplicates(rs.weightClassTables.map((t) => `${t.stream}|${t.ageDivisionCode}|${t.gender}`)).forEach((k) =>
    add('DUPLICATE_WEIGHT_TABLE', '$.weightClassTables', { scope: k }),
  );
  rs.weightClassTables.forEach((t, i) => {
    const path = `$.weightClassTables[${i}]`;
    const div = divisions.get(t.ageDivisionCode);
    if (!div) add('UNKNOWN_DIVISION_REF', path, { division: t.ageDivisionCode });
    else if (!div.streams.includes(t.stream))
      add('DIVISION_NOT_IN_STREAM', path, { division: t.ageDivisionCode, stream: t.stream });
    weightTableFindings(t.classes).forEach((f) => add(f.code, `${path}.classes`, f.params));
  });

  const policies = new Map(rs.poolPolicies.map((pp) => [pp.code, pp]));
  rs.poolPolicies.forEach((pp, i) => {
    out.push(...poolPolicyFindings(pp, `$.poolPolicies[${i}]`, divisions, schemes));
  });

  rs.categoryTemplates.forEach((t, i) => {
    const path = `$.categoryTemplates[${i}]`;
    duplicates(t.dimensions).forEach((d) => add('DUPLICATE_DIMENSION', path, { dimension: d }));
    const pooled = t.drawFormat === 'POOLED_SINGLE_ELIMINATION';
    if (pooled && (t.poolPolicyCode === null || !policies.has(t.poolPolicyCode)))
      add('POOL_POLICY_REQUIRED', path);
    if (!pooled && t.poolPolicyCode !== null) add('POOL_POLICY_NOT_APPLICABLE', path);
    const needsMovement = t.dimensions.includes('MOVEMENT');
    if (needsMovement && (t.movementMapCode === null || !maps.has(t.movementMapCode)))
      add('MOVEMENT_MAP_REQUIRED', path);
    if (!needsMovement && t.movementMapCode !== null) add('MOVEMENT_MAP_NOT_APPLICABLE', path);
    if (t.dimensions.includes('WEIGHT_CLASS') && t.discipline !== 'KYORUGI')
      add('WEIGHT_CLASS_ONLY_FOR_KYORUGI', path);
    if (t.discipline === 'KYORUGI' && !t.dimensions.includes('WEIGHT_CLASS'))
      add('KYORUGI_REQUIRES_WEIGHT_CLASS', path);
    const elimination = t.drawFormat !== 'PERFORMANCE_ORDER';
    if (elimination && (t.byePolicy === null || t.bronzeMedals === null))
      add('ELIMINATION_SETTINGS_REQUIRED', path);
    if (!rs.composition.some((c) => c.format === t.format))
      add('COMPOSITION_MISSING', path, { format: t.format });
  });

  Object.entries(rs.sourceVocabulary.divisi).forEach(([label, divCode]) => {
    if (!divisions.has(divCode))
      add('UNKNOWN_DIVISION_REF', '$.sourceVocabulary.divisi', { label, division: divCode });
  });

  return out;
}

function weightTableFindings(
  classes: RuleSet['weightClassTables'][number]['classes'],
): { code: string; params: RuleSetFinding['params'] }[] {
  const out: { code: string; params: RuleSetFinding['params'] }[] = [];
  classes.forEach((c, i) => {
    const kg = Number(c.code.slice(1)) * 1000;
    if (c.code.startsWith('-') && c.upperInclusiveG !== kg)
      out.push({ code: 'CLASS_CODE_BOUND_MISMATCH', params: { class: c.code } });
    if (c.code.startsWith('+') && (c.lowerExclusiveG !== kg || c.upperInclusiveG !== null)) {
      out.push({ code: 'CLASS_CODE_BOUND_MISMATCH', params: { class: c.code } });
    }
    if (c.upperInclusiveG === null && i !== classes.length - 1)
      out.push({ code: 'OPEN_CLASS_NOT_LAST', params: { class: c.code } });
    if (c.lowerExclusiveG !== null && c.upperInclusiveG !== null && c.lowerExclusiveG >= c.upperInclusiveG) {
      out.push({ code: 'CLASS_BOUNDS_INVERTED', params: { class: c.code } });
    }
    const prev = classes[i - 1];
    if (prev && c.lowerExclusiveG !== prev.upperInclusiveG) {
      out.push({ code: 'CLASS_TABLE_NOT_CONTIGUOUS', params: { class: c.code, previous: prev.code } });
    }
  });
  return out;
}

function poolPolicyFindings(
  pp: PoolPolicy,
  path: string,
  divisions: ReadonlyMap<string, unknown>,
  schemes: ReadonlyMap<string, RuleSet['beltBandSchemes'][number]>,
): RuleSetFinding[] {
  const out: RuleSetFinding[] = [];
  const add = (code: string, params: RuleSetFinding['params'] = {}) =>
    out.push({ code, level: 'INVALID', path, params });
  if (!(pp.poolMin <= pp.poolTarget && pp.poolTarget <= pp.poolMax))
    add('POOL_SIZE_ORDER', { code: pp.code });
  const expectedKeys = Array.from({ length: pp.poolMax }, (_, i) => String(i + 1));
  const keys = Object.keys(pp.sizePenaltyFp).sort((a, b) => Number(a) - Number(b));
  if (keys.join(',') !== expectedKeys.join(','))
    add('SIZE_PENALTY_KEYS', { expected: expectedKeys.join(','), actual: keys.join(',') });
  duplicates(pp.tolerances.map((t) => `${t.dimension}|${t.ageDivisionCode ?? '*'}`)).forEach((k) =>
    add('DUPLICATE_TOLERANCE', { scope: k }),
  );
  pp.tolerances.forEach((t) => {
    if (t.ageDivisionCode !== null && !divisions.has(t.ageDivisionCode))
      add('UNKNOWN_DIVISION_REF', { division: t.ageDivisionCode });
    if (t.max.status === 'SET' && t.max.value < t.ideal)
      add('MAX_BELOW_IDEAL', { dimension: t.dimension, division: t.ageDivisionCode });
  });
  const defaults = new Set(pp.tolerances.filter((t) => t.ageDivisionCode === null).map((t) => t.dimension));
  (['WEIGHT', 'HEIGHT', 'BELT'] as const).forEach((d) => {
    if (!defaults.has(d)) add('DEFAULT_TOLERANCE_MISSING', { dimension: d });
  });
  // HARD compares band membership, so it needs a scheme. SOFT penalizes the belt-rank range
  // through the BELT tolerance and needs no scheme; if one is given it must exist.
  if (pp.belt.policy === 'HARD' && (pp.belt.schemeCode === null || !schemes.has(pp.belt.schemeCode))) {
    add('BELT_SCHEME_REQUIRED', { policy: pp.belt.policy });
  }
  if (pp.belt.schemeCode !== null && !schemes.has(pp.belt.schemeCode))
    add('UNKNOWN_SCHEME_REF', { scheme: pp.belt.schemeCode });
  const beltTolActive = pp.tolerances.some((t) => t.dimension === 'BELT' && t.active);
  if (pp.belt.policy === 'SOFT' && !beltTolActive) add('SOFT_BELT_REQUIRES_ACTIVE_BELT_TOLERANCE');
  if (pp.belt.policy !== 'SOFT' && beltTolActive)
    add('BELT_TOLERANCE_ONLY_FOR_SOFT_POLICY', { policy: pp.belt.policy });
  return out;
}

// ---------------------------------------------------------------------------------------
// Lock readiness: committee decisions that must exist before an official draw.
// ---------------------------------------------------------------------------------------

function lockFindings(rs: RuleSet): RuleSetFinding[] {
  const out: RuleSetFinding[] = [];
  if (rs.status !== 'ACTIVE')
    out.push({
      code: 'RULE_SET_NOT_ACTIVE',
      level: 'LOCK_BLOCKER',
      path: '$.status',
      params: { status: rs.status },
    });

  rs.poolPolicies.forEach((pp, i) => {
    pp.tolerances.forEach((t, j) => {
      if (t.active && t.max.status === 'UNSET') {
        out.push({
          code: 'MAX_TOLERANCE_UNSET',
          level: 'LOCK_BLOCKER',
          path: `$.poolPolicies[${i}].tolerances[${j}]`,
          params: { policy: pp.code, dimension: t.dimension, division: t.ageDivisionCode },
        });
      }
    });
  });

  rs.weightClassTables.forEach((t, i) => {
    if (t.completeness !== 'OFFICIAL') {
      out.push({
        code: 'WEIGHT_CLASS_TABLE_NOT_OFFICIAL',
        level: 'LOCK_WARNING',
        path: `$.weightClassTables[${i}]`,
        params: { stream: t.stream, division: t.ageDivisionCode, gender: t.gender },
      });
    }
  });

  for (const { path, source } of provenanceEntries(rs)) {
    if (source === 'TBD') out.push({ code: 'VALUE_TBD', level: 'LOCK_BLOCKER', path, params: {} });
    else if (source === 'STAKEHOLDER' || source === 'EVIDENCE_2026') {
      out.push({ code: 'RULE_NOT_COMMITTEE_CONFIRMED', level: 'LOCK_WARNING', path, params: { source } });
    } else if (source === 'ENGINEERING_DEFAULT') {
      out.push({ code: 'ENGINEERING_DEFAULT_IN_USE', level: 'INFO', path, params: {} });
    }
  }
  return out;
}

function provenanceEntries(value: unknown, path = '$'): { path: string; source: string }[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => provenanceEntries(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  const out: { path: string; source: string }[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (/provenance$/i.test(key) && child !== null && typeof child === 'object' && 'source' in child) {
      out.push({ path: childPath, source: String(child.source) });
    } else {
      out.push(...provenanceEntries(child, childPath));
    }
  }
  return out;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup].sort(compareStrings);
}
