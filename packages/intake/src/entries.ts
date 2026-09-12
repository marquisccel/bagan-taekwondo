import { deriveEligibility, type EntryFormat } from '@bagantkd/domain';
import type { RuleSet } from '@bagantkd/rules';
import { compareStrings, sortedBy } from '@bagantkd/shared';

import { deriveCategory } from './categories.js';
import type { EntryGroupProposal, IntakeEntry, IntakeIssue, NormalizedRow, Person } from './types.js';
import { templateUses } from './usage.js';

const HEURISTIC_RULE = 'SAME_CONTINGENT_CATEGORY_COMPOSITION';

/**
 * Entry reconstruction (PHASE2_PLAN §6). Individual rows become entries; pair/team rows are
 * grouped by an EVIDENCE_2026 heuristic into PROPOSED groups. Ambiguity or incompleteness blocks
 * the rows — nothing is grouped best-effort.
 */
export function reconstructEntries(
  rows: readonly NormalizedRow[],
  persons: readonly Person[],
  rs: RuleSet,
): { entries: IntakeEntry[]; unresolvedRows: string[]; issues: IntakeIssue[] } {
  const personOfRow = new Map<string, Person>();
  for (const p of persons) for (const r of p.rowRefs) personOfRow.set(r, p);

  const drafts: { ref: string; members: NormalizedRow[]; group: EntryGroupProposal | null }[] = [];
  const groups = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (r.format === 'INDIVIDUAL') {
      drafts.push({ ref: r.ref, members: [r], group: null });
      continue;
    }
    const parts: (string | null)[] = [
      r.format,
      r.stream,
      r.discipline,
      r.fields.division.value,
      r.fields.contingent.value,
    ];
    if (r.format === 'TEAM') parts.push(r.fields.gender.value);
    const key = parts.map((p) => p ?? '').join('|');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const issues: IntakeIssue[] = [];
  const unresolvedRows: string[] = [];
  for (const key of sortedBy([...groups.keys()], compareStrings)) {
    const members = groups.get(key) ?? [];
    const format = members[0]?.format as EntryFormat;
    const verdict = composition(members, format, rs);
    if (verdict === 'ONE') {
      const refs = sortedBy(
        members.map((m) => m.ref),
        compareStrings,
      );
      drafts.push({
        ref: `G:${refs.join('+')}`,
        members,
        group: {
          source: 'HEURISTIC',
          status: 'PROPOSED',
          confidence: 'HIGH',
          evidence: { rule: HEURISTIC_RULE, provenance: 'EVIDENCE_2026', groupKey: key, memberRows: refs },
        },
      });
    } else {
      const code = verdict === 'AMBIGUOUS' ? 'ENTRY_GROUP_AMBIGUOUS' : 'ENTRY_GROUP_INCOMPLETE';
      for (const m of members) {
        unresolvedRows.push(m.ref);
        issues.push({
          code,
          component: null,
          severity: 'ERROR',
          subject: { kind: 'ROW', ref: m.ref },
          field: 'class',
          raw: m.fields.classOrFormat.raw,
          suggestion: null,
          rule: { code: HEURISTIC_RULE, provenance: 'EVIDENCE_2026' },
          params: { groupKey: key, rows: members.length },
        });
      }
    }
  }

  const rowIssueCodes = (r: NormalizedRow) => new Set(r.issues.map((i) => i.code));
  const entries = drafts.map<IntakeEntry>((d) => {
    const first = d.members[0] as NormalizedRow;
    const genders = d.members.map((m) => m.fields.gender.value);
    const category = deriveCategory(
      {
        stream: first.stream,
        discipline: first.discipline,
        format: first.format,
        divisionCode: first.fields.division.value,
        weightClass: first.weightClass,
        memberGenders: genders,
        memberBelts: d.members.map((m) => m.fields.belt.value),
      },
      rs,
      rowIssueCodes(first).has('UNKNOWN_CLASS') || rowIssueCodes(first).has('AMBIGUOUS_WEIGHT_CLASS'),
    );

    const entryIssues: IntakeIssue[] = [];
    const entryIssue = (
      code: IntakeIssue['code'],
      rule: string,
      provenance: IntakeIssue['rule']['provenance'],
    ) =>
      entryIssues.push({
        code,
        component: null,
        severity: 'ERROR',
        subject: { kind: 'ENTRY', ref: d.ref },
        field: null,
        raw: null,
        suggestion: null,
        rule: { code: rule, provenance },
        params: {},
      });
    for (const gap of category.gaps) {
      if (gap !== 'CATEGORY_KEY_INCOMPLETE')
        entryIssue(gap, 'CATEGORY_TEMPLATE', category.template?.provenance.source ?? 'TBD');
    }
    if (d.group !== null) entryIssue('ENTRY_GROUP_UNCONFIRMED', HEURISTIC_RULE, 'EVIDENCE_2026');

    // Member-level blockers: row ERRORs, and person conflicts (identity fields always, physical
    // fields when this entry's template uses them).
    const memberBlocking = new Set<string>();
    for (const m of d.members) {
      for (const i of m.issues) if (i.severity === 'ERROR') memberBlocking.add(i.code);
      for (const f of personOfRow.get(m.ref)?.conflicts ?? []) {
        if (
          f === 'FULL_NAME' ||
          f === 'GENDER' ||
          f === 'BIRTH_DATE' ||
          templateUses(rs, category.template, f)
        ) {
          memberBlocking.add('ATHLETE_ATTRIBUTE_CONFLICT');
        }
      }
    }
    const eligibility = deriveEligibility({
      registration: 'REGISTERED',
      openBlockingIssues: memberBlocking.size,
      overriddenIssues: 0,
      ruleGaps: category.gaps.length,
      entryGroupFinal: d.group === null,
      inLockedRevision: false,
    });
    const blockingReasons = new Set<string>([
      ...memberBlocking,
      ...entryIssues.map((i) => i.code),
      ...category.gaps,
    ]);
    return {
      ref: d.ref,
      memberRows: sortedBy(
        d.members.map((m) => m.ref),
        compareStrings,
      ),
      stream: first.stream,
      discipline: first.discipline,
      format: first.format,
      divisionCode: first.fields.division.value,
      weightClass: first.weightClass,
      contingent: first.fields.contingent.value ?? '',
      group: d.group,
      templateCode: category.template?.code ?? null,
      categoryKey: category.key,
      categoryGender: category.gender,
      issues: entryIssues,
      eligibility,
      blockingReasons: sortedBy([...blockingReasons], compareStrings),
    };
  });

  return {
    entries: sortedBy(entries, (a, b) => compareStrings(a.ref, b.ref)),
    unresolvedRows: sortedBy(unresolvedRows, compareStrings),
    issues,
  };
}

type CompositionVerdict = 'ONE' | 'AMBIGUOUS' | 'INCOMPLETE';

/** Does this row set form exactly one pair/team under the rule set's composition rule? */
function composition(
  members: readonly NormalizedRow[],
  format: EntryFormat,
  rs: RuleSet,
): CompositionVerdict {
  const rule = rs.composition.find((c) => c.format === format);
  if (!rule) return 'INCOMPLETE';
  if (rule.genders === null) {
    if (members.length === rule.size) return 'ONE';
    return members.length > rule.size && members.length % rule.size === 0 ? 'AMBIGUOUS' : 'INCOMPLETE';
  }
  const need = new Map<string, number>();
  for (const g of rule.genders) need.set(g, (need.get(g) ?? 0) + 1);
  const have = new Map<string, number>();
  for (const m of members)
    have.set(m.fields.gender.value ?? '?', (have.get(m.fields.gender.value ?? '?') ?? 0) + 1);
  const ratios = [...new Set([...need.keys(), ...have.keys()])].map((g) => {
    const n = need.get(g) ?? 0;
    const h = have.get(g) ?? 0;
    return n === 0 ? (h === 0 ? 0 : Number.NaN) : h / n;
  });
  const k = ratios[0];
  if (k === undefined || ratios.some((r) => r !== k) || !Number.isInteger(k) || k === 0) return 'INCOMPLETE';
  return k === 1 ? 'ONE' : 'AMBIGUOUS';
}
