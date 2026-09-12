import { isPlaceable } from '@bagantkd/domain';
import { assessRuleSet } from '@bagantkd/rules';
import { compareStrings, DomainError, fingerprintBytes, sortedBy, type Fingerprint } from '@bagantkd/shared';

import { parseCsv } from './csv.js';
import { reconstructEntries } from './entries.js';
import { resolvePersons } from './persons.js';
import { KOLEKTIF_2026_COLUMNS, processRow } from './rows.js';
import { buildSnapshot, type IntakeSnapshot } from './snapshot.js';
import type {
  CategorySummary,
  IntakeEntry,
  IntakeIssue,
  NormalizedRow,
  Person,
  SourceRecord,
} from './types.js';

export const ADAPTER_KOLEKTIF_2026 = 'kolektif-2026';

// WHATWG global available in every supported runtime; pure packages compile without DOM/node types.
declare const TextDecoder: new (
  label: 'utf-8',
  options: { fatal: boolean },
) => { decode(input: Uint8Array): string };

export interface IntakeRequest {
  readonly sourceName: string;
  readonly bytes: Uint8Array;
  /** Validated here; an invalid rule set is fatal (RULE_SET_INVALID), never partially applied. */
  readonly ruleSet: unknown;
}

export interface IntakeResult {
  readonly fatal: {
    readonly code: string;
    readonly params: Readonly<Record<string, string | number>>;
  } | null;
  readonly source: {
    readonly name: string;
    readonly fingerprint: Fingerprint;
    readonly rows: number;
    readonly columns: number;
  };
  readonly ruleSetFingerprint: Fingerprint | null;
  /** Source records exactly as parsed (raw strings, original column names), in file order. */
  readonly records: readonly SourceRecord[];
  readonly rows: readonly NormalizedRow[];
  readonly persons: readonly Person[];
  readonly entries: readonly IntakeEntry[];
  readonly unresolvedRows: readonly string[];
  readonly categories: readonly CategorySummary[];
  /** Every issue: row, person and entry level. */
  readonly issues: readonly IntakeIssue[];
  readonly snapshot: IntakeSnapshot | null;
  readonly snapshotFingerprint: Fingerprint | null;
}

/**
 * RAW → NORMALIZED → RESOLVED (PHASE2_PLAN §1). Pure: the same bytes and rule set always give the
 * same result and snapshot fingerprint. Bad data never throws; it becomes issues. Only a source
 * that cannot be read as the expected table is fatal.
 */
export function runIntake(req: IntakeRequest): IntakeResult {
  const sourceFp = fingerprintBytes(req.bytes);
  const empty = (
    code: string,
    params: Record<string, string | number>,
    rows = 0,
    columns = 0,
  ): IntakeResult => ({
    fatal: { code, params },
    source: { name: req.sourceName, fingerprint: sourceFp, rows, columns },
    ruleSetFingerprint: null,
    records: [],
    rows: [],
    persons: [],
    entries: [],
    unresolvedRows: [],
    categories: [],
    issues: [],
    snapshot: null,
    snapshotFingerprint: null,
  });

  const assessment = assessRuleSet(req.ruleSet, 'SIMULATION');
  if (!assessment.allowed || assessment.ruleSet === null || assessment.fingerprint === null) {
    return empty('RULE_SET_INVALID', { findings: assessment.findings.length });
  }
  const rs = assessment.ruleSet;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(req.bytes);
  } catch {
    return empty('SOURCE_NOT_UTF8', {});
  }
  let table;
  try {
    table = parseCsv(text);
  } catch (e: unknown) {
    return empty(e instanceof DomainError ? e.code : 'CSV_UNREADABLE', {});
  }
  const missing = KOLEKTIF_2026_COLUMNS.filter((c) => !table.header.includes(c));
  if (missing.length > 0)
    return empty(
      'SOURCE_COLUMNS_MISSING',
      { missing: missing.join(',') },
      table.rows.length,
      table.header.length,
    );

  const records: SourceRecord[] = table.rows.map((raw, i) => ({ rowNumber: i + 2, raw }));
  const idCounts = new Map<string, number>();
  for (const r of records) {
    const id = (r.raw['id_athlete'] ?? '').trim();
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const duplicateIds = new Set([...idCounts].filter(([id, n]) => id !== '' && n > 1).map(([id]) => id));

  const processed = records.map((r) => processRow(r, rs, duplicateIds));
  const { persons, issues: personIssues } = resolvePersons(processed);
  const { entries, unresolvedRows, issues: groupIssues } = reconstructEntries(processed, persons, rs);

  // Group issues belong to rows: attach them so every row carries its complete issue list.
  const groupIssuesByRow = new Map<string, IntakeIssue[]>();
  for (const i of groupIssues)
    groupIssuesByRow.set(i.subject.ref, [...(groupIssuesByRow.get(i.subject.ref) ?? []), i]);
  const rows = processed.map((r) =>
    groupIssuesByRow.has(r.ref) ? { ...r, issues: [...r.issues, ...(groupIssuesByRow.get(r.ref) ?? [])] } : r,
  );

  const byCategory = new Map<string, CategorySummary>();
  for (const e of entries) {
    if (e.categoryKey === null || e.templateCode === null || e.stream === null || e.discipline === null)
      continue;
    const prev = byCategory.get(e.categoryKey);
    const eligible = isPlaceable(e.eligibility) ? 1 : 0;
    byCategory.set(e.categoryKey, {
      key: e.categoryKey,
      templateCode: e.templateCode,
      stream: e.stream,
      discipline: e.discipline,
      entries: (prev?.entries ?? 0) + 1,
      eligible: (prev?.eligible ?? 0) + eligible,
      blocked: (prev?.blocked ?? 0) + (1 - eligible),
    });
  }

  const { snapshot, fingerprint } = buildSnapshot({
    adapter: ADAPTER_KOLEKTIF_2026,
    tournamentCode: rs.tournament.code,
    ruleSetCode: rs.code,
    ruleSetFingerprint: assessment.fingerprint,
    source: { name: req.sourceName, fingerprint: sourceFp, rows: records.length },
    entries,
    persons,
    unresolvedRows,
  });

  return {
    fatal: null,
    source: {
      name: req.sourceName,
      fingerprint: sourceFp,
      rows: records.length,
      columns: table.header.length,
    },
    ruleSetFingerprint: assessment.fingerprint,
    records,
    rows,
    persons,
    entries,
    unresolvedRows,
    categories: sortedBy([...byCategory.values()], (a, b) => compareStrings(a.key, b.key)),
    issues: [...rows.flatMap((r) => r.issues), ...personIssues, ...entries.flatMap((e) => e.issues)],
    snapshot,
    snapshotFingerprint: fingerprint,
  };
}
