import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import { diffIntake } from './diff.js';
import { runIntake } from './pipeline.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'), 'utf-8');
const snap = (text: string) => {
  const s = runIntake({ sourceName: 'd.csv', bytes: new TextEncoder().encode(text), ruleSet }).snapshot;
  if (!s) throw new Error('no snapshot');
  return s;
};

describe('diffIntake', () => {
  it('identical input: nothing changed', () => {
    const a = snap(csv);
    const d = diffIntake(a, snap(csv));
    expect(d).toMatchObject({
      sourceChanged: false,
      ruleSetChanged: false,
      added: [],
      removed: [],
      changed: [],
    });
    expect(d.unchanged).toBe(a.entries.length);
  });

  it('reports a corrected weight, a removed row and an added row, and leaves both snapshots untouched', () => {
    const a = snap(csv);
    const frozen = JSON.stringify(a);
    const lines = csv.split('\n').filter((l) => l !== '');
    const edited = lines
      .filter((l) => !l.startsWith('REG042,'))
      .map((l) => (l.startsWith('REG033,') ? l.replace(',155.00,45.00,', ',155.00,40.50,') : l));
    const extra = lines.find((l) => l.startsWith('REG043,'))?.replace('REG043', 'REG099') ?? '';
    const b = snap([...edited, extra].join('\n'));
    const d = diffIntake(a, b);
    expect(d.sourceChanged).toBe(true);
    expect(d.added).toEqual(['REG099']);
    expect(d.removed).toEqual(['REG042']);
    // WEIGHT_CLASS_MISMATCH is a WARNING, so only the member's weight changes.
    expect(d.changed).toEqual([{ externalRef: 'REG033', fields: ['members'] }]);
    expect(JSON.stringify(a)).toBe(frozen);
  });
});
