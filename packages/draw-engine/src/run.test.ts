import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ENGINE_VERSION, type EngineInput } from './contract.js';
import { checkPlacementInvariants } from './invariants.js';
import { runDraw } from './run.js';

const ruleSet = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;

const input = (overrides: Partial<EngineInput> = {}): EngineInput => ({
  engineVersion: ENGINE_VERSION,
  purpose: 'SIMULATION',
  seed: parseDrawSeed('20260827'),
  ruleSet,
  entries: [],
  scope: [],
  assumptions: null,
  ...overrides,
});

describe('runDraw contract', () => {
  it('every stage is implemented; an empty input is a SAFE draw with nothing to place', () => {
    const out = runDraw(input());
    expect(out.stages.every((s) => s.status === 'IMPLEMENTED')).toBe(true);
    expect(out.status).toBe('SAFE');
    expect(out.categories).toEqual([]);
  });

  it('refuses a mismatched engine version', () => {
    expect(runDraw(input({ engineVersion: '9.9.9' })).unsafeReasons.map((r) => r.code)).toContain(
      'ENGINE_VERSION_MISMATCH',
    );
  });

  it('refuses simulation assumptions on a candidate draw', () => {
    const out = runDraw(
      input({
        purpose: 'CANDIDATE',
        assumptions: {
          maxTolerances: [
            { policyCode: 'KYORUGI_SEMI_POOL', dimension: 'HEIGHT', ageDivisionCode: null, value: 100 },
          ],
        },
      }),
    );
    expect(out.unsafeReasons.map((r) => r.code)).toContain('ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE');
  });

  it('INV-05: replays to an identical fingerprint for the same input and seed', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (n) => {
        const seed = parseDrawSeed(n.toString());
        expect(runDraw(input({ seed })).fingerprints).toEqual(runDraw(input({ seed })).fingerprints);
      }),
      { numRuns: 50 },
    );
  });

  it('changes the input fingerprint when the seed changes', () => {
    const a = runDraw(input({ seed: parseDrawSeed('1') })).fingerprints.input;
    const b = runDraw(input({ seed: parseDrawSeed('2') })).fingerprints.input;
    expect(a).not.toBe(b);
  });
});

describe('placement invariants', () => {
  it('detects duplicates, missing and unexpected entries', () => {
    const v = checkPlacementInvariants(
      ['e1', 'e2', 'e3'],
      [
        { poolUid: 'p1', entryId: 'e1' },
        { poolUid: 'p2', entryId: 'e1' },
        { poolUid: 'p2', entryId: 'x9' },
      ],
    );
    expect(v.map((x) => `${x.invariant}:${x.code}:${x.subject}`)).toEqual([
      'INV-02:DUPLICATE_ENTRY:e1',
      'INV-03:MISSING_ENTRY:e2',
      'INV-03:MISSING_ENTRY:e3',
      'INV-03:UNEXPECTED_ENTRY:x9',
    ]);
  });

  it('accepts any exact partition of the eligible set', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 60 }),
        fc.integer({ min: 1, max: 4 }),
        (ids, size) => {
          const placements = ids.map((entryId, i) => ({ poolUid: `p${Math.floor(i / size)}`, entryId }));
          expect(checkPlacementInvariants(ids, placements)).toEqual([]);
        },
      ),
    );
  });
});
