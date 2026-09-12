import { canonicalJson, compareStrings, sortedBy } from '@bagantkd/shared';

import type { IntakeResult } from './pipeline.js';
import type { NormalizedFields } from './types.js';

/**
 * Data Transformation Report (instruction 2). Aggregates only — no names, NIK or birth dates —
 * so it can be committed and shared. Keys of `issueCounts`, `issueSeverityCounts` and
 * `fieldOutcomes` use the same vocabulary as the Python baseline to allow a direct differential.
 */
export interface TransformationReport {
  readonly source: IntakeResult['source'];
  readonly pipeline: {
    readonly rows: number;
    readonly persons: number;
    readonly entries: number;
    readonly entryGroups: number;
    readonly unresolvedRows: number;
    readonly categories: number;
  };
  readonly entryGroupsByProvenance: Readonly<Record<string, number>>;
  readonly heuristicGroupsByFormat: Readonly<Record<string, number>>;
  readonly categoriesByStream: Readonly<Record<string, number>>;
  readonly blockedEntries: number;
  readonly blockedEntriesByStream: Readonly<Record<string, number>>;
  readonly blockedEntriesByReason: Readonly<Record<string, number>>;
  readonly issueCounts: Readonly<Record<string, number>>;
  readonly issueSeverityCounts: Readonly<Record<string, number>>;
  readonly openIssuesBySeverity: Readonly<Record<string, number>>;
  readonly fieldOutcomes: Readonly<Record<string, number>>;
  /** Distinct value-level normalizations of non-personal fields, e.g. "=+65" → "+65". */
  readonly classNormalizations: Readonly<Record<string, string>>;
  readonly ruleProvenanceUsage: Readonly<Record<string, number>>;
  readonly suggestions: Readonly<Record<string, number>>;
  readonly categories: IntakeResult['categories'];
  readonly snapshotFingerprint: string | null;
}

const FIELD_NAMES: Readonly<Record<keyof NormalizedFields, string | null>> = {
  sourceId: null,
  name: 'name',
  gender: 'gender',
  birthDate: 'birthDate',
  heightMm: 'height',
  weightG: 'weight',
  belt: 'belt',
  classification: 'classification',
  division: 'division',
  classOrFormat: 'class',
  nik: 'nik',
  contingent: null,
};

const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const sorted = (m: Map<string, number>) =>
  Object.fromEntries(sortedBy([...m], (a, b) => compareStrings(a[0], b[0])));

export function buildTransformationReport(r: IntakeResult): TransformationReport {
  const issueCounts = new Map<string, number>();
  const severity = new Map<string, number>();
  const open = new Map<string, number>();
  const provenance = new Map<string, number>();
  const suggestions = new Map<string, number>();
  for (const i of r.issues) {
    inc(issueCounts, i.code);
    if (i.component !== null) inc(issueCounts, `${i.code}:${i.component}`);
    if (i.subject.kind === 'ROW') inc(severity, `${i.code}:${i.severity}`);
    inc(open, i.severity);
    inc(provenance, `${i.rule.provenance}:${i.rule.code}`);
    if (i.suggestion) inc(suggestions, i.suggestion.rule);
  }
  // Person/entry level counts are per subject (a person counts once).
  const outcomes = new Map<string, number>();
  const classNorm = new Map<string, string>();
  for (const row of r.rows) {
    for (const [field, t] of Object.entries(row.fields) as [
      keyof NormalizedFields,
      NormalizedFields[keyof NormalizedFields],
    ][]) {
      const name = FIELD_NAMES[field];
      if (name !== null) inc(outcomes, `${name}:${t.outcome}`);
      inc(provenance, `${t.rule.provenance}:${t.rule.code}`);
    }
    const c = row.fields.classOrFormat;
    if (c.outcome === 'NORMALIZED' && c.value !== null) classNorm.set(c.raw, c.value);
  }
  const blockedByStream = new Map<string, number>();
  const blockedByReason = new Map<string, number>();
  const groupsByProvenance = new Map<string, number>();
  const groupsByFormat = new Map<string, number>();
  let blocked = 0;
  for (const e of r.entries) {
    if (e.group) {
      inc(groupsByProvenance, `${e.group.source}/${e.group.status}/${e.group.confidence}`);
      inc(groupsByFormat, `${e.stream ?? '?'}:${e.discipline ?? '?'}:${e.format}`);
    }
    if (e.eligibility === 'BLOCKED') {
      blocked += 1;
      inc(blockedByStream, `${e.stream ?? '?'}:${e.discipline ?? '?'}`);
      for (const reason of e.blockingReasons) inc(blockedByReason, reason);
    }
  }
  const byStream = new Map<string, number>();
  for (const c of r.categories) inc(byStream, `${c.stream}:${c.discipline}`);

  return {
    source: r.source,
    pipeline: {
      rows: r.rows.length,
      persons: r.persons.length,
      entries: r.entries.length,
      entryGroups: r.entries.filter((e) => e.group !== null).length,
      unresolvedRows: r.unresolvedRows.length,
      categories: r.categories.length,
    },
    entryGroupsByProvenance: sorted(groupsByProvenance),
    heuristicGroupsByFormat: sorted(groupsByFormat),
    categoriesByStream: sorted(byStream),
    blockedEntries: blocked,
    blockedEntriesByStream: sorted(blockedByStream),
    blockedEntriesByReason: sorted(blockedByReason),
    issueCounts: sorted(issueCounts),
    issueSeverityCounts: sorted(severity),
    openIssuesBySeverity: sorted(open),
    fieldOutcomes: sorted(outcomes),
    classNormalizations: Object.fromEntries(sortedBy([...classNorm], (a, b) => compareStrings(a[0], b[0]))),
    ruleProvenanceUsage: sorted(provenance),
    suggestions: sorted(suggestions),
    categories: r.categories,
    snapshotFingerprint: r.snapshotFingerprint,
  };
}

// ---------------------------------------------------------------------------------------
// Differential validation (instruction 10)
// ---------------------------------------------------------------------------------------

export interface BaselineCounts {
  readonly rows: number;
  readonly persons: number;
  readonly entries: number;
  readonly entryGroups: number;
  readonly entryGroupsByProvenance: Readonly<Record<string, number>>;
  readonly unresolvedRows: number;
  readonly categories: number;
  readonly categoriesByStream: Readonly<Record<string, number>>;
  readonly blockedEntries: number;
  readonly blockedEntriesByStream: Readonly<Record<string, number>>;
  readonly issueCounts: Readonly<Record<string, number>>;
  readonly issueSeverityCounts: Readonly<Record<string, number>>;
  readonly fieldOutcomes: Readonly<Record<string, number>>;
}

export interface BaselineDetail {
  readonly rows: Readonly<Record<string, readonly string[]>>;
  readonly entries: Readonly<
    Record<
      string,
      { readonly members: readonly string[]; readonly category: string | null; readonly eligibility: string }
    >
  >;
}

export interface Difference {
  readonly scope: string;
  readonly key: string;
  readonly baseline: unknown;
  readonly implementation: unknown;
}

function compareRecords(
  scope: string,
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Difference[] {
  const keys = sortedBy([...new Set([...Object.keys(a), ...Object.keys(b)])], compareStrings);
  return keys
    .filter((k) => (a[k] ?? 0) !== (b[k] ?? 0))
    .map((k) => ({ scope, key: k, baseline: a[k] ?? 0, implementation: b[k] ?? 0 }));
}

export function diffAgainstBaseline(report: TransformationReport, base: BaselineCounts): Difference[] {
  const d: Difference[] = [];
  const scalar = (key: string, b: number, i: number) => {
    if (b !== i) d.push({ scope: 'pipeline', key, baseline: b, implementation: i });
  };
  scalar('rows', base.rows, report.pipeline.rows);
  scalar('persons', base.persons, report.pipeline.persons);
  scalar('entries', base.entries, report.pipeline.entries);
  scalar('entryGroups', base.entryGroups, report.pipeline.entryGroups);
  scalar('unresolvedRows', base.unresolvedRows, report.pipeline.unresolvedRows);
  scalar('categories', base.categories, report.pipeline.categories);
  scalar('blockedEntries', base.blockedEntries, report.blockedEntries);
  d.push(
    ...compareRecords(
      'entryGroupsByProvenance',
      base.entryGroupsByProvenance,
      report.entryGroupsByProvenance,
    ),
  );
  d.push(...compareRecords('categoriesByStream', base.categoriesByStream, report.categoriesByStream));
  d.push(
    ...compareRecords('blockedEntriesByStream', base.blockedEntriesByStream, report.blockedEntriesByStream),
  );
  d.push(...compareRecords('issueCounts', base.issueCounts, report.issueCounts));
  d.push(...compareRecords('issueSeverityCounts', base.issueSeverityCounts, report.issueSeverityCounts));
  d.push(...compareRecords('fieldOutcomes', base.fieldOutcomes, report.fieldOutcomes));
  return d;
}

/** Row-by-row and entry-by-entry comparison with the private baseline detail. */
export function diffAgainstDetail(r: IntakeResult, base: BaselineDetail): Difference[] {
  const d: Difference[] = [];
  const rowCodes = new Map(
    r.rows.map((row) => [
      row.ref,
      sortedBy(
        row.issues.map((i) => `${i.code}${i.component ? `:${i.component}` : ''}:${i.severity}`),
        compareStrings,
      ),
    ]),
  );
  for (const ref of sortedBy([...new Set([...Object.keys(base.rows), ...rowCodes.keys()])], compareStrings)) {
    const b = base.rows[ref] ?? null;
    const i = rowCodes.get(ref) ?? null;
    if (canonicalJson(b) !== canonicalJson(i))
      d.push({ scope: 'row', key: ref, baseline: b, implementation: i });
  }
  const entries = new Map(
    r.entries.map((e) => [
      e.ref,
      {
        members: e.memberRows,
        category: e.categoryKey,
        eligibility: e.eligibility === 'BLOCKED' ? 'BLOCKED' : 'READY',
      },
    ]),
  );
  for (const ref of sortedBy(
    [...new Set([...Object.keys(base.entries), ...entries.keys()])],
    compareStrings,
  )) {
    const b = base.entries[ref] ?? null;
    const i = entries.get(ref) ?? null;
    if (canonicalJson(b) !== canonicalJson(i))
      d.push({ scope: 'entry', key: ref, baseline: b, implementation: i });
  }
  return d;
}
