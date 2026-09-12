import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTransformationReport, runIntake, toCsv } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import { defaultSyntheticOptions, generateSyntheticRows, SOURCE_COLUMNS } from './synthetic.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;

type Pattern = 'ZERO' | 'SWAP' | 'HEIGHT_7' | 'NIK_DOT';

/** Issue codes that only the injected dirty-data patterns can cause. */
const EXPECTED: Record<Pattern, readonly (readonly string[])[]> = {
  ZERO: [['HEIGHT_MISSING', 'WEIGHT_MISSING']],
  // A swap whose swapped pair is still plausible cannot be recognized as a swap; BMI catches it.
  SWAP: [['HEIGHT_WEIGHT_LIKELY_SWAPPED'], ['BMI_IMPLAUSIBLE']],
  HEIGHT_7: [['HEIGHT_OUT_OF_RANGE']],
  NIK_DOT: [['NIK_NORMALIZED']],
};
const INJECTED_CODES = new Set<string>(
  Object.values(EXPECTED).flat(2).concat(['WEIGHT_OUT_OF_RANGE', 'WEIGHT_CLASS_MISMATCH']),
);
/**
 * Issues clean synthetic rows may legitimately carry, each with its cause:
 * - CLASS_FORMAT_NORMALIZED: the generator writes over-classes as `=+NN`, like the 2026 export.
 * - DOB_POSSIBLE_PLACEHOLDER: uniformly random birth dates include placeholder-looking dates.
 * - ENTRY_GROUP_*: the export has no group id; several pairs/teams of one contingent and division
 *   are ambiguous under the EVIDENCE_2026 heuristic and must be blocked, not guessed.
 */
const BACKGROUND = new Set<string>([
  'CLASS_FORMAT_NORMALIZED',
  'DOB_POSSIBLE_PLACEHOLDER',
  'ENTRY_GROUP_AMBIGUOUS',
  'ENTRY_GROUP_UNCONFIRMED',
]);

describe.each([
  ['SYNTHETIC_5K', 5000, '5000'],
  ['SYNTHETIC_10K', 10_000, '10000'],
] as const)('%s intake (E9)', (_name, rows, seed) => {
  const options = defaultSyntheticOptions(rows, seed);
  const clean = generateSyntheticRows(ruleSet, { ...options, dirtyPermille: 0 });
  const dirty = generateSyntheticRows(ruleSet, options);
  const csv = toCsv(SOURCE_COLUMNS, dirty, { neutralizeFormulas: false }).replace(/\n$/, '');
  const result = runIntake({ sourceName: _name, bytes: new TextEncoder().encode(csv), ruleSet });

  // Injection happens after generation, so the clean rows are the dirty rows before injection.
  const injected = new Map<string, Pattern>();
  dirty.forEach((d, i) => {
    const c = clean[i];
    if (!c || JSON.stringify(c) === JSON.stringify(d)) return;
    const p: Pattern =
      d.tinggibadan === '0.00' && d.beratbadan === '0.00'
        ? 'ZERO'
        : d.tinggibadan === c.beratbadan && d.beratbadan === c.tinggibadan
          ? 'SWAP'
          : d.nik !== c.nik
            ? 'NIK_DOT'
            : 'HEIGHT_7';
    injected.set(d.id_athlete, p);
  });

  it('imports without a fatal error; every row accounted for; one person per row', () => {
    expect(result.fatal).toBeNull();
    const r = buildTransformationReport(result);
    expect(r.pipeline.rows).toBe(rows);
    expect(r.pipeline.persons).toBe(rows);
    const placed = result.entries.flatMap((e) => e.memberRows);
    expect(placed.length + result.unresolvedRows.length).toBe(rows);
    expect(result.snapshot?.entries.length).toBeGreaterThan(0);
  });

  it('the injection rate is the configured one (within sampling error)', () => {
    const expected = (rows * options.dirtyPermille) / 1000;
    expect(injected.size).toBeGreaterThan(expected * 0.5);
    expect(injected.size).toBeLessThan(expected * 1.5);
  });

  it('every injected row carries the issue its pattern must cause', () => {
    for (const [ref, pattern] of injected) {
      const codes = new Set<string>(result.rows.find((r) => r.ref === ref)?.issues.map((i) => i.code));
      expect(
        EXPECTED[pattern].some((alt) => alt.every((c) => codes.has(c))),
        `${ref} ${pattern}: ${[...codes].join(',')}`,
      ).toBe(true);
    }
  });

  it('data-defect issues occur only on injected rows; everything else is explained background', () => {
    for (const row of result.rows) {
      for (const i of row.issues) {
        if (INJECTED_CODES.has(i.code)) expect(injected.has(row.ref), `${row.ref} ${i.code}`).toBe(true);
        else expect(BACKGROUND.has(i.code), `${row.ref} ${i.code}`).toBe(true);
      }
    }
    expect(result.issues.filter((i) => i.subject.kind === 'PERSON')).toEqual([]);
  });
});
