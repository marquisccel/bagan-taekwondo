import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assessRuleSet, type RuleSetFinding } from './readiness.js';
import type { RuleSet } from './schema.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
);
const loadFixture = (): RuleSet => JSON.parse(readFileSync(fixturePath, 'utf-8')) as RuleSet;
const codes = (findings: readonly RuleSetFinding[], level?: RuleSetFinding['level']) =>
  findings.filter((f) => level === undefined || f.level === level).map((f) => f.code);

/** Applies every committee decision the provisional set is waiting for. */
function withCommitteeDecisions(rs: RuleSet): RuleSet {
  const copy = structuredClone(rs);
  copy.status = 'ACTIVE';
  for (const pp of copy.poolPolicies) {
    for (const t of pp.tolerances) {
      t.max =
        t.dimension === 'BELT'
          ? { status: 'NONE', provenance: { source: 'COMMITTEE' } }
          : { status: 'SET', value: t.ideal * 2, provenance: { source: 'COMMITTEE' } };
    }
  }
  for (const t of copy.categoryTemplates) t.provenance = { source: 'COMMITTEE' };
  return copy;
}

describe('provisional 2026 rule set', () => {
  it('is structurally valid and usable for simulation and candidate draws', () => {
    for (const purpose of ['SIMULATION', 'CANDIDATE'] as const) {
      const a = assessRuleSet(loadFixture(), purpose);
      expect(codes(a.findings, 'INVALID')).toEqual([]);
      expect(a.allowed).toBe(true);
    }
  });

  it('is refused for LOCK while maximum tolerances and semi-prestasi medals are undecided', () => {
    const a = assessRuleSet(loadFixture(), 'LOCK');
    expect(a.allowed).toBe(false);
    const blockers = a.findings.filter((f) => f.level === 'LOCK_BLOCKER');
    const unset = blockers
      .filter((f) => f.code === 'MAX_TOLERANCE_UNSET')
      .map((f) => `${String(f.params['policy'])}/${String(f.params['dimension'])}`);
    expect(unset.sort()).toEqual([
      'KYORUGI_SEMI_POOL/BELT',
      'KYORUGI_SEMI_POOL/HEIGHT',
      'KYORUGI_SEMI_POOL/WEIGHT',
      'POOMSAE_SEMI_POOL/HEIGHT',
    ]);
    expect(codes(blockers)).toContain('RULE_SET_NOT_ACTIVE');
    expect(codes(blockers).filter((c) => c === 'VALUE_TBD')).toHaveLength(2);
  });

  it('never fills a maximum tolerance on its own', () => {
    const input = loadFixture();
    const before = JSON.stringify(input);
    const a = assessRuleSet(input, 'LOCK');
    expect(JSON.stringify(input)).toBe(before);
    for (const pp of a.ruleSet?.poolPolicies ?? []) {
      for (const t of pp.tolerances) expect(t.max.status).toBe('UNSET');
    }
  });

  it('becomes lockable once the committee decides, still requiring acknowledgement of warnings', () => {
    const a = assessRuleSet(withCommitteeDecisions(loadFixture()), 'LOCK');
    expect(codes(a.findings, 'LOCK_BLOCKER')).toEqual([]);
    expect(a.allowed).toBe(true);
    expect(a.requiresAcknowledgement).toBe(true);
    expect(codes(a.findings, 'LOCK_WARNING')).toContain('WEIGHT_CLASS_TABLE_NOT_OFFICIAL');
  });
});

describe('structural validation', () => {
  const invalidCodes = (mutate: (rs: RuleSet) => void) => {
    const rs = loadFixture();
    mutate(rs);
    return codes(assessRuleSet(rs, 'SIMULATION').findings, 'INVALID');
  };

  it('rejects a maximum below the ideal', () => {
    expect(
      invalidCodes((rs) => {
        const t = rs.poolPolicies[0]?.tolerances[0];
        if (t) t.max = { status: 'SET', value: t.ideal - 1, provenance: { source: 'COMMITTEE' } };
      }),
    ).toContain('MAX_BELOW_IDEAL');
  });

  it('rejects a weight-class table with a gap', () => {
    expect(
      invalidCodes((rs) => {
        const c = rs.weightClassTables[0]?.classes[1];
        if (c) c.lowerExclusiveG = (c.lowerExclusiveG ?? 0) + 1000;
      }),
    ).toContain('CLASS_TABLE_NOT_CONTIGUOUS');
  });

  it('rejects a movement map that leaves a band unmapped', () => {
    expect(invalidCodes((rs) => rs.movementMaps[0]?.entries.pop())).toContain('BAND_WITHOUT_MOVEMENT');
  });

  it('rejects HARD belt policy without a band scheme', () => {
    expect(
      invalidCodes((rs) => {
        const pp = rs.poolPolicies[0];
        if (pp) pp.belt = { policy: 'HARD', schemeCode: null, provenance: { source: 'COMMITTEE' } };
      }),
    ).toContain('BELT_SCHEME_REQUIRED');
  });

  it('rejects a pooled template without a pool policy', () => {
    expect(
      invalidCodes((rs) => {
        const t = rs.categoryTemplates.find((x) => x.drawFormat === 'POOLED_SINGLE_ELIMINATION');
        if (t) t.poolPolicyCode = null;
      }),
    ).toContain('POOL_POLICY_REQUIRED');
  });

  it('rejects non-integer units through the schema', () => {
    const rs = loadFixture() as unknown as { poolPolicies: { tolerances: { ideal: number }[] }[] };
    const t = rs.poolPolicies[0]?.tolerances[0];
    if (t) t.ideal = 4.5;
    const a = assessRuleSet(rs, 'SIMULATION');
    expect(a.allowed).toBe(false);
    expect(codes(a.findings)).toContain('SCHEMA_VIOLATION');
  });
});

describe('rule-set fingerprint', () => {
  it('is independent of key order and changes with any value', () => {
    const base = assessRuleSet(loadFixture(), 'SIMULATION').fingerprint;
    expect(base).not.toBeNull();
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v !== null && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, c]) => [k, reverseKeys(c)]),
            )
          : v;
    expect(assessRuleSet(reverseKeys(loadFixture()), 'SIMULATION').fingerprint).toBe(base);

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (ideal) => {
        const rs = loadFixture();
        const t = rs.poolPolicies[0]?.tolerances[0];
        if (!t || t.ideal === ideal) return;
        t.ideal = ideal;
        expect(assessRuleSet(rs, 'SIMULATION').fingerprint).not.toBe(base);
      }),
      { numRuns: 25 },
    );
  });
});
