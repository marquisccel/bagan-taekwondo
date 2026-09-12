import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { beforeAll, describe, expect, it } from 'vitest';

import { runIntake, type IntakeResult } from './pipeline.js';
import {
  buildTransformationReport,
  diffAgainstBaseline,
  diffAgainstDetail,
  type BaselineCounts,
  type BaselineDetail,
  type TransformationReport,
} from './report.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const datasetPath = root('data/private/DATA_KOLEKTIF_FESTIVAL_PRESTASI - query_kolektif.csv');
const detailPath = root('data/private/phase2-2026-detail.json');
const available = existsSync(datasetPath);
if (!available)
  process.stdout.write('\n  [golden] SKIPPED: private 2026 dataset not found (see data/README.md)\n');

/**
 * O1 — ACCEPTANCE_CRITERIA §5 (Phase 2). These numbers are the acceptance contract for the 2026
 * dataset only; they never appear in business logic.
 */
const O1 = {
  rows: 3154,
  persons: 3121,
  entries: 3115,
  entryGroups: 28,
  categories: 238,
  categoriesByStream: {
    'PRESTASI:KYORUGI': 71,
    'SEMI_PRESTASI:KYORUGI': 105,
    'SEMI_PRESTASI:POOMSAE': 36,
    'PRESTASI:POOMSAE': 17,
    'PRESTASI:FREESTYLE_POOMSAE': 9,
  },
  blockedSemiPrestasi: 21,
  issues: {
    HEIGHT_MISSING: 9,
    WEIGHT_MISSING: 9,
    HEIGHT_WEIGHT_LIKELY_SWAPPED: 12,
    HEIGHT_OUT_OF_RANGE: 1,
    WEIGHT_OUT_OF_RANGE: 1,
    BMI_IMPLAUSIBLE: 3,
    WEIGHT_CLASS_MISMATCH: 252,
    AGE_DIVISION_PLAY_UP: 64,
    AGE_DIVISION_CONFLICT: 0,
    NIK_INVALID_FORMAT: 56,
    NIK_NORMALIZED: 6,
    NIK_GENDER_MISMATCH: 22,
    'NIK_BIRTHDATE_MISMATCH:YEAR': 59,
    'NIK_BIRTHDATE_MISMATCH:DAY_MONTH': 155,
    DOB_POSSIBLE_PLACEHOLDER: 14,
    ATHLETE_ATTRIBUTE_CONFLICT: 1,
    ATHLETE_MULTIPLE_CONTINGENTS: 11,
    CLASS_FORMAT_NORMALIZED: 145,
    UNKNOWN_CLASS: 0,
    UNKNOWN_BELT: 0,
    UNKNOWN_DIVISION: 0,
    ENTRY_GROUP_AMBIGUOUS: 0,
  },
} as const;

describe.skipIf(!available)('golden 2026 intake: O3 (TypeScript) vs O1 (acceptance) vs O2 (Python)', () => {
  let result: IntakeResult;
  let report: TransformationReport;
  beforeAll(() => {
    const ruleSet = JSON.parse(
      readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
    ) as RuleSet;
    result = runIntake({ sourceName: 'REAL_2026', bytes: readFileSync(datasetPath), ruleSet });
    report = buildTransformationReport(result);
  });

  it('E1: reproduces every acceptance value (O1)', () => {
    expect(result.fatal).toBeNull();
    expect(report.pipeline).toMatchObject({
      rows: O1.rows,
      persons: O1.persons,
      entries: O1.entries,
      entryGroups: O1.entryGroups,
      categories: O1.categories,
      unresolvedRows: 0,
    });
    expect(report.categoriesByStream).toEqual(O1.categoriesByStream);
    expect(report.entryGroupsByProvenance).toEqual({ 'HEURISTIC/PROPOSED/HIGH': 28 });
    const semiBlocked =
      (report.blockedEntriesByStream['SEMI_PRESTASI:KYORUGI'] ?? 0) +
      (report.blockedEntriesByStream['SEMI_PRESTASI:POOMSAE'] ?? 0);
    expect(semiBlocked).toBe(O1.blockedSemiPrestasi);
    for (const [code, n] of Object.entries(O1.issues)) {
      expect(report.issueCounts[code] ?? 0, code).toBe(n);
    }
  });

  it('E2: equals the independent Python baseline on every aggregate (O2)', () => {
    const base = JSON.parse(
      readFileSync(root('fixtures/baselines/phase2-2026-counts.json'), 'utf-8'),
    ) as BaselineCounts;
    expect(diffAgainstBaseline(report, base)).toEqual([]);
  });

  it.skipIf(!existsSync(detailPath))(
    'E2: equals the Python baseline on every row and every entry (private detail)',
    () => {
      const detail = JSON.parse(readFileSync(detailPath, 'utf-8')) as BaselineDetail;
      const diffs = diffAgainstDetail(result, detail);
      expect(diffs.slice(0, 20)).toEqual([]);
      expect(diffs).toHaveLength(0);
    },
  );

  it('E9: is deterministic — same bytes and rules give the same snapshot fingerprint', () => {
    const ruleSet = JSON.parse(
      readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
    ) as RuleSet;
    const again = runIntake({ sourceName: 'REAL_2026', bytes: readFileSync(datasetPath), ruleSet });
    expect(again.snapshotFingerprint).toBe(result.snapshotFingerprint);
  });

  it('pipeline invariant: every row is in exactly one entry or listed as unresolved', () => {
    const placed = result.entries.flatMap((e) => e.memberRows);
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length + result.unresolvedRows.length).toBe(result.rows.length);
  });

  it('snapshot contains no personal data', () => {
    const text = JSON.stringify(result.snapshot);
    const sample = result.rows.slice(0, 200);
    for (const r of sample) {
      if (r.fields.nik.value) expect(text).not.toContain(r.fields.nik.value);
      if (r.fields.name.value && r.fields.name.value.length > 6)
        expect(text).not.toContain(r.fields.name.value);
      if (r.fields.birthDate.value) expect(text).not.toContain(r.fields.birthDate.value);
    }
  });
});
