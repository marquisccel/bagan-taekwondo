import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake, type IntakeSnapshot } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import { ENGINE_VERSION, type EngineEntry, type EngineInput, type EngineOutput } from './contract.js';
import { runDraw } from './run.js';

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
const codes = (out: EngineOutput) => out.unsafeReasons.map((r) => r.code);

/** Stages 1–4 on the regression fixture: the engine re-verifies what the intake snapshot says. */
describe('engine stages 1–4 on the dirty-case snapshot', () => {
  let snapshot: IntakeSnapshot;
  let out: EngineOutput;
  beforeAll(() => {
    const r = runIntake({
      sourceName: 'dirty-cases.csv',
      bytes: readFileSync(root('fixtures/intake/dirty-cases.csv')),
      ruleSet,
    });
    if (!r.snapshot) throw new Error('no snapshot');
    snapshot = r.snapshot;
    out = runDraw(input(snapshot.entries));
  });

  it('a full-scope draw is UNSAFE because categories are blocked; blocked categories place nothing', () => {
    expect(out.status).toBe('UNSAFE');
    expect(codes(out)).toEqual(['CATEGORY_BLOCKED']);
    for (const c of out.categories) if (c.readiness === 'BLOCKED') expect(c.pools).toEqual([]);
  });

  it('agrees with the intake: no disagreement, no key mismatch, no malformed entry', () => {
    expect(codes(out)).not.toContain('INTAKE_DISAGREEMENT');
    expect(codes(out)).not.toContain('CATEGORY_KEY_MISMATCH');
    expect(codes(out)).not.toContain('ENTRY_MALFORMED');
    expect(out.quality.findings.filter((f) => f.level === 'ERROR')).toEqual([]);
  });

  it('a withheld entry whose key cannot be re-derived (belt conflict) is unverified, still blocks its category', () => {
    const e = snapshot.entries.find((x) => x.externalRef === 'REG018');
    expect(e?.members[0]?.beltCode).toBeNull();
    expect(out.quality.findings).toContainEqual(
      expect.objectContaining({ level: 'INFO', code: 'CATEGORY_KEY_UNVERIFIED', subject: e?.entryId }),
    );
    const cat = out.categories.find((c) => c.categoryKey === e?.categoryKey);
    expect(cat?.withheldEntryIds).toContain(e?.entryId);
    expect(cat?.readiness).toBe('BLOCKED');
  });

  it('eligible = intake READY entries; every BLOCKED entry is withheld with its reasons', () => {
    const ready = snapshot.entries.filter((e) => e.eligibility === 'READY').map((e) => e.entryId);
    const inCategories = out.categories.flatMap((c) => c.entryIds);
    expect(new Set(inCategories).size).toBe(inCategories.length);
    expect([...inCategories].sort()).toEqual([...ready].sort());
    expect(out.quality.metrics['entriesEligible']).toBe(ready.length);
    expect(out.quality.metrics['entriesWithheld']).toBe(snapshot.entries.length - ready.length);
  });

  it('BLOCK_CATEGORY policy (ENGINEERING_DEFAULT): a category holding a withheld entry is BLOCKED', () => {
    expect(ruleSet.categoryReadiness).toMatchObject({
      withheldEntries: 'BLOCK_CATEGORY',
      provenance: { source: 'ENGINEERING_DEFAULT' },
    });
    for (const c of out.categories) {
      expect(c.readiness === 'BLOCKED').toBe(c.withheldEntryIds.length > 0 || c.entryIds.length === 0);
    }
    const withheld = out.categories.find((c) => c.withheldEntryIds.length > 0 && c.entryIds.length > 0);
    expect(withheld?.blockedReasons).toContainEqual({
      code: 'ENTRIES_WITHHELD',
      params: {
        entries: withheld?.withheldEntryIds.length ?? 0,
        policy: 'BLOCK_CATEGORY',
        provenance: 'ENGINEERING_DEFAULT',
      },
    });
    expect(codes(out)).toContain('CATEGORY_BLOCKED');
  });

  it('DRAW_ELIGIBLE_ONLY policy: withheld entries stay out and do not block their category', () => {
    const rs: RuleSet = {
      ...ruleSet,
      categoryReadiness: { withheldEntries: 'DRAW_ELIGIBLE_ONLY', provenance: { source: 'COMMITTEE' } },
    };
    const r = runDraw(input(snapshot.entries, { ruleSet: rs }));
    for (const c of r.categories) expect(c.readiness === 'BLOCKED').toBe(c.entryIds.length === 0);
    expect(r.categories.flatMap((c) => c.entryIds)).toEqual(out.categories.flatMap((c) => c.entryIds));
  });

  it('a singleton category (one eligible entry, nothing withheld) is READY, not invalid', () => {
    const singleton = out.categories.find((c) => c.entryIds.length === 1 && c.withheldEntryIds.length === 0);
    expect(singleton).toBeDefined();
    expect(singleton?.readiness).toBe('READY');
    expect(singleton?.blockedReasons).toEqual([]);
  });

  it('detects a tampered category key', () => {
    const e = snapshot.entries.find((x) => x.categoryKey !== null && x.eligibility === 'READY');
    if (!e) throw new Error('fixture has no ready entry');
    const tampered = snapshot.entries.map((x) =>
      x === e ? { ...x, categoryKey: `${x.categoryKey ?? ''}X` } : x,
    );
    const r = runDraw(input(tampered));
    expect(r.unsafeReasons).toContainEqual({ code: 'CATEGORY_KEY_MISMATCH', params: { entries: 1 } });
  });

  it('refuses to place an entry the intake marked READY when the engine finds it invalid', () => {
    const e = snapshot.entries.find(
      (x) => x.stream === 'SEMI_PRESTASI' && x.discipline === 'KYORUGI' && x.eligibility === 'READY',
    );
    if (!e) throw new Error('fixture has no ready semi kyorugi entry');
    const tampered = snapshot.entries.map((x) =>
      x === e ? { ...x, members: x.members.map((m) => ({ ...m, heightMm: null })) } : x,
    );
    const r = runDraw(input(tampered));
    expect(r.unsafeReasons).toContainEqual({ code: 'INTAKE_DISAGREEMENT', params: { entries: 1 } });
    expect(r.categories.flatMap((c) => c.entryIds)).not.toContain(e.entryId);
    expect(r.quality.findings).toContainEqual(
      expect.objectContaining({ level: 'ERROR', code: 'INTAKE_DISAGREEMENT', subject: e.entryId }),
    );
  });

  it('a BLOCKED entry flipped to READY with an unknown class is caught', () => {
    const e = snapshot.entries.find((x) => x.externalRef === 'REG014');
    if (!e) throw new Error('REG014 missing');
    expect(e.eligibility).toBe('BLOCKED');
    const tampered = snapshot.entries.map((x) =>
      x === e ? { ...x, eligibility: 'READY' as const, weightClassCode: '53' } : x,
    );
    expect(codes(runDraw(input(tampered)))).toContain('INTAKE_DISAGREEMENT');
  });

  it('rejects malformed entries: duplicate id, fractional measure', () => {
    const [a, b] = snapshot.entries;
    if (!a || !b) throw new Error('fixture too small');
    const dup = runDraw(input([...snapshot.entries, { ...b, entryId: a.entryId }]));
    expect(codes(dup)).toContain('ENTRY_MALFORMED');
    const frac = runDraw(
      input(
        snapshot.entries.map((x) =>
          x === a ? { ...x, members: x.members.map((m) => ({ ...m, heightMm: 1500.5 })) } : x,
        ),
      ),
    );
    expect(frac.quality.findings).toContainEqual(
      expect.objectContaining({ code: 'ENTRY_MALFORMED', subject: a.entryId }),
    );
  });

  it('scope restricts categories; an unknown scope key is refused', () => {
    const key = out.categories[0]?.categoryKey ?? '';
    const scoped = runDraw(input(snapshot.entries, { scope: [key] }));
    expect(scoped.categories.map((c) => c.categoryKey)).toEqual([key]);
    expect(codes(runDraw(input(snapshot.entries, { scope: ['NOPE'] })))).toContain('SCOPE_CATEGORY_UNKNOWN');
  });

  it('entry order does not change categories or findings', () => {
    fc.assert(
      fc.property(fc.nat(), (rot) => {
        const n = snapshot.entries.length;
        const rotated = [...snapshot.entries.slice(rot % n), ...snapshot.entries.slice(0, rot % n)].reverse();
        const r = runDraw(input(rotated));
        expect(r.categories).toEqual(out.categories);
        expect(r.quality).toEqual(out.quality);
        expect(r.unsafeReasons).toEqual(out.unsafeReasons);
      }),
      { numRuns: 25 },
    );
  });
});
