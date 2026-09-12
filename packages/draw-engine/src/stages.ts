import { isPlaceable } from '@bagantkd/domain';
import { deriveCategory, templateUses } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { compareStrings, sortedBy } from '@bagantkd/shared';

import type { EngineEntry, Reason } from './contract.js';

/**
 * Stages 1–4 of the draw (PHASE2_PLAN §9): normalizeEntries → validateEntries → gateEligibility →
 * buildCategories. Pure functions of (entries, rule set). The engine re-checks everything the
 * intake snapshot claims and trusts nothing: a disagreement is a finding, never silently resolved.
 */

export interface EntryFinding {
  readonly stage: 'normalizeEntries' | 'validateEntries' | 'gateEligibility' | 'buildCategories';
  readonly entryId: string;
  readonly reason: Reason;
}

const finding = (
  stage: EntryFinding['stage'],
  entryId: string,
  code: string,
  params: Reason['params'] = {},
): EntryFinding => ({ stage, entryId, reason: { code, params } });

const isNonNegInt = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);

/**
 * Stage 1. Canonical order (entryId) and structural soundness: unique ids, integer units,
 * at least one member, sorted blocking reasons. Malformed entries are rejected, not repaired.
 */
export function normalizeEntries(entries: readonly EngineEntry[]): {
  entries: EngineEntry[];
  rejected: EntryFinding[];
} {
  const rejected: EntryFinding[] = [];
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.entryId, (seen.get(e.entryId) ?? 0) + 1);

  const ok: EngineEntry[] = [];
  for (const e of entries) {
    const problems: string[] = [];
    if ((seen.get(e.entryId) ?? 0) > 1) problems.push('DUPLICATE_ENTRY_ID');
    if (e.members.length === 0) problems.push('NO_MEMBERS');
    if (new Set(e.members.map((m) => m.athleteId)).size !== e.members.length)
      problems.push('DUPLICATE_MEMBER');
    for (const m of e.members) {
      if (!isNonNegInt(m.heightMm) || !isNonNegInt(m.weightG) || !isNonNegInt(m.birthYear)) {
        problems.push('NON_INTEGER_MEASURE');
      }
    }
    if (e.seedNo !== null && !(Number.isSafeInteger(e.seedNo) && e.seedNo >= 1))
      problems.push('INVALID_SEED_NO');
    if (problems.length > 0) {
      for (const code of [...new Set(problems)].sort(compareStrings)) {
        rejected.push(finding('normalizeEntries', e.entryId, 'ENTRY_MALFORMED', { problem: code }));
      }
      continue;
    }
    ok.push({ ...e, blockingReasons: sortedBy([...e.blockingReasons], compareStrings) });
  }
  return { entries: sortedBy(ok, (a, b) => compareStrings(a.entryId, b.entryId)), rejected };
}

/**
 * Stage 2. Each entry against the rule set, independently of the intake's verdict: known
 * division for the stream, a category template, composition, the weight class exists in its
 * table, members carry what the template uses. Returns problems per entry.
 */
export function validateEntries(entries: readonly EngineEntry[], rs: RuleSet): EntryFinding[] {
  const out: EntryFinding[] = [];
  for (const e of entries) {
    const push = (code: string, params: Reason['params'] = {}) =>
      out.push(finding('validateEntries', e.entryId, code, params));
    const division = rs.ageDivisions.find((d) => d.code === e.ageDivisionCode);
    if (!division) push('UNKNOWN_AGE_DIVISION', { division: e.ageDivisionCode });
    else if (!division.streams.includes(e.stream))
      push('DIVISION_NOT_IN_STREAM', { division: e.ageDivisionCode });

    const template = rs.categoryTemplates.find(
      (t) => t.stream === e.stream && t.discipline === e.discipline && t.format === e.format,
    );
    if (!template) {
      push('NO_CATEGORY_TEMPLATE');
      continue;
    }
    const comp = rs.composition.find((c) => c.format === e.format);
    if (!comp || comp.size !== e.members.length) {
      push('COMPOSITION_MISMATCH', { members: e.members.length, expected: comp?.size ?? null });
    } else if (comp.genders !== null) {
      const have = e.members.map((m) => m.gender ?? '?').sort(compareStrings);
      const need = [...comp.genders].sort(compareStrings);
      if (have.join(',') !== need.join(',')) push('COMPOSITION_MISMATCH', { genders: have.join(',') });
    }
    if (e.members.some((m) => m.gender === null)) push('MEMBER_GENDER_MISSING');
    if (e.members.some((m) => m.birthYear === null)) push('MEMBER_BIRTH_YEAR_MISSING');

    if (template.dimensions.includes('WEIGHT_CLASS')) {
      const table = rs.weightClassTables.find(
        (t) =>
          t.stream === e.stream && t.ageDivisionCode === e.ageDivisionCode && t.gender === e.categoryGender,
      );
      if (e.weightClassCode === null) push('WEIGHT_CLASS_MISSING');
      else if (!table?.classes.some((c) => c.code === e.weightClassCode)) {
        push('UNKNOWN_CLASS', { class: e.weightClassCode });
      }
    }
    // Physical fields the template uses must be present for a placeable entry.
    const placeable = isPlaceable(e.eligibility);
    for (const [field, present] of [
      ['HEIGHT', e.members.every((m) => m.heightMm !== null)],
      ['WEIGHT', e.members.every((m) => m.weightG !== null)],
      ['BELT', e.members.every((m) => m.beltCode !== null)],
    ] as const) {
      if (placeable && !present && templateUses(rs, template, field)) push('USED_FIELD_MISSING', { field });
    }
  }
  return out;
}

/**
 * Stage 3. An entry is placeable only if the intake says so (READY / OVERRIDDEN / DRAWN) AND the
 * engine found nothing wrong with it. Intake-READY but engine-invalid is an INTAKE_DISAGREEMENT:
 * the entry is withheld and the run is unsafe — the engine never places what it cannot verify.
 */
export function gateEligibility(
  entries: readonly EngineEntry[],
  engineProblems: readonly EntryFinding[],
): { eligible: EngineEntry[]; withheld: EntryFinding[]; disagreements: EntryFinding[] } {
  const problemsOf = new Map<string, EntryFinding[]>();
  for (const p of engineProblems) problemsOf.set(p.entryId, [...(problemsOf.get(p.entryId) ?? []), p]);

  const eligible: EngineEntry[] = [];
  const withheld: EntryFinding[] = [];
  const disagreements: EntryFinding[] = [];
  for (const e of entries) {
    const problems = problemsOf.get(e.entryId) ?? [];
    if (!isPlaceable(e.eligibility)) {
      withheld.push(
        finding('gateEligibility', e.entryId, 'ENTRY_BLOCKED', { reasons: e.blockingReasons.join(',') }),
      );
    } else if (problems.length > 0) {
      const codes = sortedBy([...new Set(problems.map((p) => p.reason.code))], compareStrings).join(',');
      withheld.push(finding('gateEligibility', e.entryId, 'ENGINE_VALIDATION_FAILED', { reasons: codes }));
      disagreements.push(finding('gateEligibility', e.entryId, 'INTAKE_DISAGREEMENT', { reasons: codes }));
    } else {
      eligible.push(e);
    }
  }
  return { eligible, withheld, disagreements };
}

export interface BuiltCategory {
  readonly categoryKey: string;
  readonly templateCode: string;
  readonly entryIds: readonly string[];
  /** Entries whose snapshot key is this category but which are withheld. */
  readonly withheldEntryIds: readonly string[];
}

/**
 * Stage 4. Re-derives every entry's category key from its facts with the rule set's templates and
 * compares it with the snapshot's key.
 *
 * - Eligible entry: the derived key must equal the snapshot key, else CATEGORY_KEY_MISMATCH.
 * - Withheld entry whose facts are too incomplete to derive a key (e.g. a conflicting belt the
 *   snapshot carries as null): CATEGORY_KEY_UNVERIFIED (informational). It still counts against
 *   its registered (snapshot) category so that category stays BLOCKED until it is resolved.
 * - Withheld entry with a derivable key that differs: CATEGORY_KEY_MISMATCH.
 *
 * Only eligible entries are partitioned; withheld ones are listed so readiness can report them.
 */
export function buildCategories(
  all: readonly EngineEntry[],
  eligibleIds: ReadonlySet<string>,
  rs: RuleSet,
  scope: readonly string[],
): { categories: BuiltCategory[]; mismatches: EntryFinding[]; unverified: EntryFinding[] } {
  const mismatches: EntryFinding[] = [];
  const unverified: EntryFinding[] = [];
  const byKey = new Map<string, { templateCode: string; eligible: string[]; withheld: string[] }>();
  for (const e of all) {
    const derived = deriveCategory(
      {
        stream: e.stream,
        discipline: e.discipline,
        format: e.format,
        divisionCode: e.ageDivisionCode,
        weightClass: e.weightClassCode,
        memberGenders: e.members.map((m) => m.gender),
        memberBelts: e.members.map((m) => m.beltCode),
      },
      rs,
      false,
    );
    const eligible = eligibleIds.has(e.entryId);
    const params = { snapshot: e.categoryKey, derived: derived.key };
    let key = derived.key;
    if (derived.key !== e.categoryKey) {
      if (!eligible && derived.key === null) {
        unverified.push(finding('buildCategories', e.entryId, 'CATEGORY_KEY_UNVERIFIED', params));
        key = e.categoryKey;
      } else {
        mismatches.push(finding('buildCategories', e.entryId, 'CATEGORY_KEY_MISMATCH', params));
        if (eligible) continue; // never partition an entry whose category is in doubt
      }
    }
    if (key === null || derived.template === null) continue;
    if (scope.length > 0 && !scope.includes(key)) continue;
    const slot = byKey.get(key) ?? { templateCode: derived.template.code, eligible: [], withheld: [] };
    (eligible ? slot.eligible : slot.withheld).push(e.entryId);
    byKey.set(key, slot);
  }
  const categories = sortedBy([...byKey.keys()], compareStrings).map((categoryKey) => {
    const s = byKey.get(categoryKey) ?? { templateCode: '', eligible: [], withheld: [] };
    return {
      categoryKey,
      templateCode: s.templateCode,
      entryIds: sortedBy(s.eligible, compareStrings),
      withheldEntryIds: sortedBy(s.withheld, compareStrings),
    };
  });
  return { categories, mismatches, unverified };
}
