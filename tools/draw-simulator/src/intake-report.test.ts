import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake, type BaselineCounts, type BaselineDetail } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import { buildIntakeReport, renderIntakeReport } from './intake-report.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string): unknown => JSON.parse(readFileSync(root(p), 'utf-8'));
const ruleSet = read('fixtures/rulesets/piala-gubernur-2026.provisional.json') as RuleSet;

describe('intake report (E8)', () => {
  const result = runIntake({
    sourceName: 'dirty-cases.csv',
    bytes: readFileSync(root('fixtures/intake/dirty-cases.csv')),
    ruleSet,
  });
  const build = () =>
    buildIntakeReport({
      result,
      ruleSet,
      baselineCounts: read('fixtures/intake/dirty-cases.python-counts.json') as BaselineCounts,
      baselineDetail: read('fixtures/intake/dirty-cases.python-detail.json') as BaselineDetail,
    });

  it('reports zero differences against the Python baseline on aggregates and on every row and entry', () => {
    const { report } = build();
    expect(report.differential.aggregate).toEqual({ compared: true, differences: [] });
    expect(report.differential.detail).toEqual({
      compared: true,
      rowsCompared: 44,
      entriesCompared: 37,
      rowDifferences: 0,
      entryDifferences: 0,
    });
    expect(report.engine.metrics).toMatchObject({ intakeDisagreements: 0, categoryKeyMismatches: 0 });
    expect(report.engine.readinessPolicy).toEqual({
      withheldEntries: 'BLOCK_CATEGORY',
      provenance: 'ENGINEERING_DEFAULT',
    });
  });

  it('is deterministic and contains no personal data', () => {
    const a = build();
    expect(build().fingerprint).toBe(a.fingerprint);
    const text = JSON.stringify(a.report) + renderIntakeReport(a.report, a.fingerprint);
    for (const row of result.rows) {
      if (row.fields.nik.value) expect(text).not.toContain(row.fields.nik.value);
      if (row.fields.birthDate.value) expect(text).not.toContain(row.fields.birthDate.value);
      if (row.fields.name.value) expect(text).not.toContain(row.fields.name.value);
    }
  });

  it('a baseline mutation is detected and reported', () => {
    const counts = read('fixtures/intake/dirty-cases.python-counts.json') as BaselineCounts;
    const { report } = buildIntakeReport({
      result,
      ruleSet,
      baselineCounts: { ...counts, persons: counts.persons + 1 },
      baselineDetail: null,
    });
    expect(report.differential.aggregate.differences).toEqual([
      { scope: 'pipeline', key: 'persons', baseline: counts.persons + 1, implementation: counts.persons },
    ]);
  });
});
