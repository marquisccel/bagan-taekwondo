import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake, type IntakeSnapshot } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed, Prng } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { ENGINE_CODES, isEngineCode } from './codes.js';
import { ENGINE_VERSION, type EngineEntry, type EngineInput, type EngineOutput } from './contract.js';
import { DEFAULT_ENGINE_LIMITS } from './limits.js';
import { runDraw } from './run.js';

/** Production hardening: contract, failure taxonomy, resource guards, lock policy, order independence. */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const input = (entries: readonly EngineEntry[], overrides: Partial<EngineInput> = {}): EngineInput => ({
  engineVersion: ENGINE_VERSION,
  purpose: 'SIMULATION',
  seed: parseDrawSeed('20260827'),
  ruleSet,
  entries,
  scope: [],
  assumptions: null,
  ...overrides,
});
const ready = (out: EngineOutput) =>
  out.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
const codesOf = (out: EngineOutput) => out.unsafeReasons.map((r) => r.code);
const blockedOf = (out: EngineOutput) => out.categories.flatMap((c) => c.blockedReasons.map((r) => r.code));

let entries: EngineEntry[];
let semiKey: string;
let prestasiKey: string;
/** `n` clean Kyorugi semi-prestasi entries in one READY category (two contingents). */
const semiCategory = (n: number, template: EngineEntry, prefix = 'f'): EngineEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    ...template,
    entryId: `${prefix}0000000-0000-8000-8000-${String(i).padStart(12, '0')}`,
    externalRef: `${prefix.toUpperCase()}${i}`,
    contingentKey: i % 3 === 0 ? 'Kota B' : 'Kota A',
    members: [
      {
        ...(template.members[0] as EngineEntry['members'][number]),
        athleteId: `${prefix}a${i}`,
        heightMm: 1450 + ((i * 37) % 200),
        weightG: 42_100 + ((i * 53) % 3000),
      },
    ],
  }));

beforeAll(() => {
  const snap = runIntake({
    sourceName: 'dirty-cases.csv',
    bytes: readFileSync(root('fixtures/intake/dirty-cases.csv')),
    ruleSet,
  }).snapshot as IntakeSnapshot;
  const plan = runDraw(input(snap.entries));
  const semi = plan.categories.find(
    (c) => c.readiness === 'READY' && c.templateCode === 'KYORUGI_SEMI_PRESTASI',
  );
  const prestasi = plan.categories.find(
    (c) => c.readiness === 'READY' && c.templateCode === 'KYORUGI_PRESTASI',
  );
  semiKey = semi?.categoryKey ?? '';
  prestasiKey = prestasi?.categoryKey ?? '';
  const template = snap.entries.find((e) => e.entryId === semi?.entryIds[0]) as EngineEntry;
  entries = [...snap.entries, ...semiCategory(11, template)];
});

describe('contract: SAFE / UNSAFE / FAILED', () => {
  it('an UNSAFE run returns no pool, bracket or candidate — never a partial draw', () => {
    const out = runDraw(input(entries));
    expect(out.status).toBe('UNSAFE');
    expect(out.failure).toBeNull();
    for (const c of out.categories) {
      expect(c.pools).toEqual([]);
      expect(c.candidates).toEqual([]);
    }
    expect(out.quality.metrics['entriesPlaced']).toBeUndefined();
    expect(out.categories.some((c) => c.readiness === 'READY')).toBe(true);
  });

  it('an execution failure is FAILED with a stable code, no draw, and fully serializable', () => {
    const poisoned = new Proxy({} as EngineEntry, {
      get() {
        throw new Error('unreadable entry');
      },
    });
    const out = runDraw(input([...entries, poisoned]));
    expect(out.status).toBe('FAILED');
    expect(out.failure).toMatchObject({ code: 'ENGINE_INTERNAL_ERROR', message: 'unreadable entry' });
    expect(out.categories).toEqual([]);
    expect(out.lock.lockable).toBe(false);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('every output is plain JSON (serializable, no undefined, no functions)', () => {
    for (const out of [
      runDraw(input(entries)),
      runDraw(input(entries, { scope: ready(runDraw(input(entries))) })),
    ]) {
      expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    }
  });

  it('the output does not depend on the order of the input entries', () => {
    const scope = ready(runDraw(input(entries)));
    const a = runDraw(input(entries, { scope }));
    const shuffled = Prng.fromSeed(parseDrawSeed('99'), 'order').shuffled(entries);
    const b = runDraw(input(shuffled, { scope: [...scope].reverse() }));
    expect(b.fingerprints).toEqual(a.fingerprints);
  });
});

describe('failure taxonomy: every emitted code is a catalogued stable code', () => {
  it('covers SAFE, UNSAFE and FAILED outputs, candidates, pools, byes and lock blockers', () => {
    const scope = ready(runDraw(input(entries)));
    const outputs = [
      runDraw(input(entries)),
      runDraw(input(entries, { scope })),
      runDraw(input(entries, { engineVersion: '9.9.9' })),
      runDraw(input(entries, { scope: ['NOPE'] })),
      runDraw(input(entries, { limits: { maxEntries: 1 } })),
    ];
    const ruleSetCodes = new Set(['MAX_TOLERANCE_UNSET', 'VALUE_TBD', 'RULE_SET_NOT_ACTIVE']);
    for (const out of outputs) {
      for (const r of out.unsafeReasons) expect(isEngineCode('UNSAFE', r.code), r.code).toBe(true);
      for (const r of out.lock.blockers)
        expect(isEngineCode('LOCK_BLOCKER', r.code) || ruleSetCodes.has(r.code), r.code).toBe(true);
      for (const f of out.quality.findings) expect(isEngineCode('FINDING', f.code), f.code).toBe(true);
      for (const c of out.categories) {
        for (const r of c.blockedReasons) expect(isEngineCode('CATEGORY_BLOCKED', r.code), r.code).toBe(true);
        for (const r of c.reasons) expect(isEngineCode('CATEGORY', r.code), r.code).toBe(true);
        for (const k of c.candidates) {
          for (const e of k.explanations) {
            expect(isEngineCode('CANDIDATE', e.code), e.code).toBe(true);
            if (e.code === 'CHANGES_REJECTED')
              expect(isEngineCode('REJECTION', String(e.params['reason'])), String(e.params['reason'])).toBe(
                true,
              );
          }
          for (const v of k.violations) expect(isEngineCode('CANDIDATE', v.code), v.code).toBe(true);
        }
        for (const p of c.pools) {
          for (const r of p.reasons) expect(isEngineCode('POOL', r.code), r.code).toBe(true);
          for (const s of p.bracket.slots)
            if (s.byeReason) expect(isEngineCode('BYE', s.byeReason.code), s.byeReason.code).toBe(true);
        }
      }
    }
    const failed = runDraw(
      input([
        new Proxy({} as EngineEntry, {
          get: () => {
            throw new Error('x');
          },
        }),
      ]),
    );
    expect(isEngineCode('FAILURE', failed.failure?.code ?? '')).toBe(true);
    expect(new Set(Object.values(ENGINE_CODES).flat()).size).toBeGreaterThan(40);
  });
});

describe('defects found in hardening (now refused with a stable code)', () => {
  it('duplicate manual seed numbers block the category instead of being silently re-ranked', () => {
    const cat = runDraw(input(entries)).categories.find((c) => c.categoryKey === semiKey);
    const [a, b] = cat?.entryIds ?? [];
    const seeded = entries.map((e) => (e.entryId === a || e.entryId === b ? { ...e, seedNo: 1 } : e));
    const out = runDraw(input(seeded, { scope: [semiKey] }));
    expect(out.status).toBe('UNSAFE');
    expect(out.categories[0]?.blockedReasons).toContainEqual({
      code: 'MANUAL_SEED_INVALID',
      params: { problem: 'DUPLICATE_SEED_NO', seedNo: 1 },
    });
  });

  it('a seed number beyond the bracket size is refused, not moved', () => {
    const cat = runDraw(input(entries)).categories.find((c) => c.categoryKey === prestasiKey);
    const target = cat?.entryIds[0];
    const seeded = entries.map((e) => (e.entryId === target ? { ...e, seedNo: 99 } : e));
    const out = runDraw(input(seeded, { scope: [prestasiKey] }));
    expect(out.categories[0]?.blockedReasons.map((r) => r.code)).toEqual(['MANUAL_SEED_INVALID']);
  });

  it('singleton policy BLOCK_CATEGORY is honored: the category waits for a person, nothing is merged', () => {
    const rs: RuleSet = {
      ...ruleSet,
      poolPolicies: ruleSet.poolPolicies.map((p) => ({
        ...p,
        singleton: { ...p.singleton, policy: 'BLOCK_CATEGORY' as const },
      })),
    };
    const plan = runDraw(input(entries, { ruleSet: rs }));
    const walkoverCats = runDraw(input(entries, { scope: ready(runDraw(input(entries))) }))
      .categories.filter((c) => c.templateCode.endsWith('SEMI_PRESTASI') && c.pools.some((p) => p.isWalkover))
      .map((c) => c.categoryKey);
    expect(walkoverCats.length).toBeGreaterThan(0);
    for (const key of walkoverCats) {
      const c = plan.categories.find((x) => x.categoryKey === key);
      expect(c?.readiness).toBe('BLOCKED');
      expect(c?.blockedReasons.map((r) => r.code)).toContain('SINGLETON_POLICY_BLOCK');
    }
  });
});

describe('resource guards (RESOURCE_LIMIT_EXCEEDED, never a hang)', () => {
  it('defaults are far above the benchmarked workloads', () => {
    expect(DEFAULT_ENGINE_LIMITS).toEqual({
      maxEntries: 50_000,
      maxCategoryEntries: 2_000,
      maxBracketEntries: 512,
      maxPoolSize: 8,
      maxPools: 20_000,
      maxWorkPerCandidate: 5_000_000,
    });
  });

  it('each limit refuses with the limit, its value and the actual size', () => {
    const scope = ready(runDraw(input(entries)));
    const tooMany = runDraw(input(entries, { limits: { maxEntries: 10 } }));
    expect(tooMany.unsafeReasons).toContainEqual({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxEntries', value: 10, actual: entries.length, scope: 'INPUT' },
    });
    expect(tooMany.categories).toEqual([]);
    const bigCategory = runDraw(input(entries, { scope: [semiKey], limits: { maxCategoryEntries: 5 } }));
    expect(bigCategory.categories[0]?.blockedReasons[0]).toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxCategoryEntries', value: 5 },
    });
    const bracket = runDraw(input(entries, { scope: [prestasiKey], limits: { maxBracketEntries: 0 } }));
    expect(bracket.categories[0]?.blockedReasons[0]).toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxBracketEntries' },
    });
    const poolSize = runDraw(input(entries, { scope: [semiKey], limits: { maxPoolSize: 3 } }));
    expect(poolSize.categories[0]?.blockedReasons[0]).toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxPoolSize', value: 3, actual: 4 },
    });
    const pools = runDraw(input(entries, { scope, limits: { maxPools: 2 } }));
    expect(pools.unsafeReasons).toContainEqual(
      expect.objectContaining({
        code: 'RESOURCE_LIMIT_EXCEEDED',
        params: expect.objectContaining({ limit: 'maxPools', value: 2 }),
      }),
    );
    const work = runDraw(input(entries, { scope: [semiKey], limits: { maxWorkPerCandidate: 50 } }));
    expect(work.categories[0]?.blockedReasons[0]).toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxWorkPerCandidate', value: 50 },
    });
    for (const out of [tooMany, bigCategory, bracket, poolSize, pools, work]) {
      expect(out.status).toBe('UNSAFE');
      expect(out.categories.every((c) => c.pools.length === 0)).toBe(true);
    }
  });

  it('a pathological 2,000-entry category terminates quickly under the default limits', () => {
    const template = entries.find((e) => e.categoryKey === semiKey) as EngineEntry;
    const already = entries.filter((e) => e.categoryKey === semiKey).length;
    const huge = semiCategory(DEFAULT_ENGINE_LIMITS.maxCategoryEntries - already, template, 'p');
    const started = performance.now();
    const out = runDraw(input([...entries, ...huge], { scope: [semiKey] }));
    const seconds = (performance.now() - started) / 1000;
    expect(out.categories[0]?.entryIds).toHaveLength(DEFAULT_ENGINE_LIMITS.maxCategoryEntries);
    process.stdout
      .write(`  [hardening] 2,000-entry category: ${out.status} ${JSON.stringify(out.categories[0]?.blockedReasons ?? [])} in ${seconds.toFixed(1)} s
`);
    expect(['SAFE', 'UNSAFE']).toContain(out.status);
    if (out.status === 'UNSAFE')
      expect(out.categories[0]?.blockedReasons[0]?.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(seconds).toBeLessThan(120);
    const over = runDraw(input([...entries, ...semiCategory(2001, template, 'q')], { scope: [semiKey] }));
    expect(over.categories[0]?.blockedReasons[0]).toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      params: { limit: 'maxCategoryEntries' },
    });
  }, 180_000);
});

describe('UNSET tolerance policy: simulate and candidate draws work, nothing is lockable', () => {
  it('a SAFE SIMULATION run is not lockable; a SAFE CANDIDATE run is blocked by the UNSET maxima', () => {
    const scope = ready(runDraw(input(entries)));
    const sim = runDraw(input(entries, { scope }));
    expect(sim.status).toBe('SAFE');
    expect(sim.lock.lockable).toBe(false);
    expect(sim.lock.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(['SIMULATION_RUN_NOT_LOCKABLE', 'MAX_TOLERANCE_UNSET']),
    );
    const cand = runDraw(input(entries, { scope, purpose: 'CANDIDATE' }));
    expect(cand.status).toBe('SAFE');
    expect(cand.lock.lockable).toBe(false);
    const codes = cand.lock.blockers.map((b) => b.code);
    expect(codes).not.toContain('SIMULATION_RUN_NOT_LOCKABLE');
    expect(codes.filter((c) => c === 'MAX_TOLERANCE_UNSET')).toHaveLength(4);
    expect(ruleSet.poolPolicies.flatMap((p) => p.tolerances).every((t) => t.max.status === 'UNSET')).toBe(
      true,
    );
  });

  it('simulation assumptions never make a run lockable', () => {
    const out = runDraw(
      input(entries, {
        scope: [semiKey],
        assumptions: {
          maxTolerances: [
            { policyCode: 'KYORUGI_SEMI_POOL', dimension: 'HEIGHT', ageDivisionCode: null, value: 100 },
          ],
        },
      }),
    );
    expect(out.lock.blockers.map((b) => b.code)).toContain('ASSUMPTIONS_PRESENT');
    expect(codesOf(out)).toEqual([]);
    expect(blockedOf(out)).toEqual([]);
  });
});
