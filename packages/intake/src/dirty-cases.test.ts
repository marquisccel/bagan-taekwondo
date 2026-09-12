import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, compareStrings, sortedBy } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { runIntake, type IntakeResult } from './pipeline.js';
import {
  buildTransformationReport,
  diffAgainstBaseline,
  diffAgainstDetail,
  type BaselineCounts,
  type BaselineDetail,
} from './report.js';
import type { NormalizedFields } from './types.js';

/**
 * Regression fixture for every data defect found in 2026 (instruction 11). The expected file is
 * hand-written from PHASE2_PLAN, so this test checks both implementations against a human oracle:
 * TypeScript (O3) directly, and the Python baseline (O2) through its committed output.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string): unknown => JSON.parse(readFileSync(root(p), 'utf-8'));

interface Expected {
  counts: {
    rows: number;
    persons: number;
    entries: number;
    entryGroups: number;
    unresolvedRows: number;
    categories: number;
    blockedEntries: number;
  };
  rows: Record<string, string[]>;
  personIssues: Record<string, number>;
  entryIssues: Record<string, number>;
  entries: Record<string, { category: string | null; eligibility: string }>;
  blockingReasons: Record<string, string[]>;
  suggestions: Record<string, { rule: string; alternatives: Record<string, string>[] }>;
  normalized: Record<
    string,
    Partial<Record<keyof NormalizedFields, { raw: string; value: string | number | null; outcome: string }>>
  >;
}

const expected = read('fixtures/intake/dirty-cases.expected.json') as Expected;
const issueString = (i: { code: string; component: string | null; severity: string }) =>
  `${i.code}${i.component ? `:${i.component}` : ''}:${i.severity}`;

describe('regression fixture: 2026 dirty-data cases', () => {
  let result: IntakeResult;
  beforeAll(() => {
    result = runIntake({
      sourceName: 'dirty-cases.csv',
      bytes: readFileSync(root('fixtures/intake/dirty-cases.csv')),
      ruleSet: read('fixtures/rulesets/piala-gubernur-2026.provisional.json'),
    });
  });

  it('pipeline counts', () => {
    const r = buildTransformationReport(result);
    expect({ ...r.pipeline, blockedEntries: r.blockedEntries }).toEqual(expected.counts);
  });

  it('every row carries exactly its expected issue codes and severities', () => {
    const actual = Object.fromEntries(
      result.rows.map((row) => [row.ref, sortedBy(row.issues.map(issueString), compareStrings)]),
    );
    expect(actual).toEqual(expected.rows);
  });

  it('person- and entry-level issues', () => {
    const count = (kind: string, code: string) =>
      result.issues.filter((i) => i.subject.kind === kind && i.code === code).length;
    for (const [code, n] of Object.entries(expected.personIssues))
      expect(count('PERSON', code), code).toBe(n);
    for (const [code, n] of Object.entries(expected.entryIssues)) expect(count('ENTRY', code), code).toBe(n);
  });

  it('every entry has its expected category and eligibility; blocking reasons are explained', () => {
    const actual = Object.fromEntries(
      result.entries.map((e) => [e.ref, { category: e.categoryKey, eligibility: e.eligibility }]),
    );
    expect(actual).toEqual(expected.entries);
    for (const [ref, reasons] of Object.entries(expected.blockingReasons)) {
      expect(result.entries.find((e) => e.ref === ref)?.blockingReasons, ref).toEqual(reasons);
    }
    for (const e of result.entries) {
      if (e.eligibility === 'BLOCKED') expect(e.blockingReasons.length, e.ref).toBeGreaterThan(0);
    }
  });

  it('suggestions are proposed, never applied', () => {
    for (const [ref, s] of Object.entries(expected.suggestions)) {
      const withSuggestion = result.rows
        .find((r) => r.ref === ref)
        ?.issues.find((i) => i.suggestion !== null);
      expect(withSuggestion?.suggestion, ref).toEqual(s);
    }
    // The swapped row keeps its raw values and has no usable measurement.
    const swapped = result.rows.find((r) => r.ref === 'REG003');
    expect(swapped?.fields.heightMm.raw).toBe('45.00');
    expect(swapped?.heightUsable).toBe(false);
    const entry = result.snapshot?.entries.find((e) => e.externalRef === 'REG003');
    expect(entry?.members[0]?.heightMm).toBeNull();
  });

  it('normalized values keep the raw value byte-for-byte', () => {
    for (const [ref, fields] of Object.entries(expected.normalized)) {
      const row = result.rows.find((r) => r.ref === ref);
      for (const [field, t] of Object.entries(fields)) {
        const trace = row?.fields[field as keyof NormalizedFields];
        expect({ raw: trace?.raw, value: trace?.value, outcome: trace?.outcome }, `${ref}.${field}`).toEqual(
          t,
        );
      }
    }
  });

  it('ambiguous and incomplete groups are unresolved, never grouped best-effort', () => {
    expect(result.unresolvedRows).toEqual(['REG022', 'REG023', 'REG024', 'REG025', 'REG026', 'REG027']);
    expect(result.entries.some((e) => e.memberRows.some((m) => result.unresolvedRows.includes(m)))).toBe(
      false,
    );
    const pair = result.entries.find((e) => e.ref === 'G:REG020+REG021');
    expect(pair?.group).toMatchObject({ source: 'HEURISTIC', status: 'PROPOSED', confidence: 'HIGH' });
  });

  it('every trace and issue names its rule and provenance', () => {
    const allowed = ['COMMITTEE', 'STAKEHOLDER', 'EVIDENCE_2026', 'ENGINEERING_DEFAULT', 'TBD'];
    for (const row of result.rows) {
      for (const t of Object.values(row.fields)) {
        expect(t.rule.code.length).toBeGreaterThan(0);
        expect(allowed).toContain(t.rule.provenance);
      }
    }
    for (const i of result.issues) expect(allowed).toContain(i.rule.provenance);
  });

  it('the Python baseline (O2) agrees with the same hand-written expectations and with TypeScript', () => {
    const pyDetail = read('fixtures/intake/dirty-cases.python-detail.json') as BaselineDetail;
    const pyCounts = read('fixtures/intake/dirty-cases.python-counts.json') as BaselineCounts;
    expect(canonicalJson(pyDetail.rows)).toBe(canonicalJson(expected.rows));
    expect(
      Object.fromEntries(
        Object.entries(pyDetail.entries).map(([k, v]) => [
          k,
          { category: v.category, eligibility: v.eligibility },
        ]),
      ),
    ).toEqual(expected.entries);
    expect(diffAgainstDetail(result, pyDetail)).toEqual([]);
    expect(diffAgainstBaseline(buildTransformationReport(result), pyCounts)).toEqual([]);
  });
});
