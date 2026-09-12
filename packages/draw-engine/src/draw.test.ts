import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runIntake, type IntakeSnapshot } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { standardRanks } from './bracket.js';
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
const readyScope = (out: EngineOutput) =>
  out.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);

/** Stages 5–14 end to end on the regression fixture plus a synthetic semi-prestasi category. */
describe('draw stages 5–14', () => {
  let entries: EngineEntry[];
  let out: EngineOutput;
  beforeAll(() => {
    const snap = runIntake({
      sourceName: 'dirty-cases.csv',
      bytes: readFileSync(root('fixtures/intake/dirty-cases.csv')),
      ruleSet,
    }).snapshot as IntakeSnapshot;
    // Eleven clean Kyorugi semi-prestasi entries added to a READY category (several pools, two contingents).
    const first = runDraw(input(snap.entries));
    const readySemi = first.categories.find(
      (c) => c.readiness === 'READY' && c.templateCode === 'KYORUGI_SEMI_PRESTASI',
    );
    const template = snap.entries.find((e) => e.entryId === readySemi?.entryIds[0]) as EngineEntry;
    const extra = Array.from({ length: 11 }, (_, i) => ({
      ...template,
      entryId: `00000000-0000-8000-8000-${String(i).padStart(12, '0')}`,
      externalRef: `SYN${i}`,
      contingentKey: i % 3 === 0 ? 'Kota B' : 'Kota A',
      members: [
        {
          ...(template.members[0] as EngineEntry['members'][number]),
          athleteId: `a${i}`,
          heightMm: 1480 + i * 7,
          weightG: 42_100 + i * 150,
        },
      ],
    }));
    entries = [...snap.entries, ...extra];
    const plan = runDraw(input(entries));
    out = runDraw(input(entries, { scope: readyScope(plan) }));
  });

  it('a READY-scope draw is SAFE and places every eligible in-scope entry exactly once, in its own category', () => {
    expect(out.status).toBe('SAFE');
    for (const c of out.categories) {
      const placed = c.pools.flatMap((p) => p.entryIds);
      expect([...placed].sort()).toEqual([...c.entryIds].sort());
      const keys = new Set(placed.map((id) => entries.find((e) => e.entryId === id)?.categoryKey));
      expect([...keys]).toEqual([c.categoryKey]);
    }
  });

  it('all five strategies are kept per pooled category; exactly one is selected, without tier-0 violations', () => {
    const pooled = out.categories.filter((c) => c.templateCode.endsWith('SEMI_PRESTASI'));
    expect(pooled.length).toBeGreaterThan(0);
    for (const c of pooled) {
      expect(c.candidates.map((k) => k.strategy).sort()).toEqual([
        'BALANCED',
        'BELT_FIRST',
        'CONTINGENT_AWARE',
        'HEIGHT_FIRST',
        'WEIGHT_FIRST',
      ]);
      expect(c.candidates.filter((k) => k.selected)).toHaveLength(1);
      const sel = c.candidates.find((k) => k.selected);
      expect(sel?.tier0Violations).toBe(0);
      expect(sel?.partition.map((p) => [...p].sort())).toEqual(c.pools.map((p) => [...p.entryIds].sort()));
      for (const k of c.candidates)
        expect(k.explanations.some((e) => e.code === 'CANDIDATE_RANK')).toBe(true);
      expect(c.reasons.some((r) => r.code === 'CANDIDATE_SELECTED')).toBe(true);
    }
  });

  it('explainability: every pool has a reason, every bye has a reason, every singleton is a walkover with suggestions', () => {
    for (const c of out.categories) {
      for (const p of c.pools) {
        expect(p.reasons.length, p.poolUid).toBeGreaterThan(0);
        for (const s of p.bracket.slots) if (s.entryId === null) expect(s.byeReason).not.toBeNull();
        if (p.isWalkover) {
          expect(p.reasons.map((r) => r.code)).toContain('SINGLETON_WALKOVER');
          expect(out.quality.findings).toContainEqual(
            expect.objectContaining({ level: 'WARNING', code: 'SINGLETON_WALKOVER', subject: p.entryIds[0] }),
          );
          expect(
            c.reasons.some((r) => r.code === 'MERGE_SUGGESTION' || r.code === 'NO_MERGE_SUGGESTION'),
          ).toBe(true);
        }
      }
    }
    const suggestion = out.categories.flatMap((c) => c.reasons).find((r) => r.code === 'MERGE_SUGGESTION');
    expect(suggestion?.params).toMatchObject({ applied: false, requires: 'TECHNICAL_DELEGATE_DECISION' });
  });

  it('the synthetic category is pooled into sizes ≤ 4 with round-1 contingent separation', () => {
    const c = out.categories.find((x) => x.entryIds.some((id) => id.startsWith('00000000-0000-8000')));
    expect(c?.pools.length).toBeGreaterThanOrEqual(3);
    for (const p of c?.pools ?? []) {
      expect(p.entryIds.length).toBeLessThanOrEqual(4);
      expect(p.bracket.matches.filter((m) => m.real)).toHaveLength(p.entryIds.length - 1);
    }
    // Placement reaches the exact minimum of same-contingent round-1 meetings in every pool.
    for (const x of out.categories)
      for (const p of x.pools)
        if (p.metrics['minSameContingentRound1'] !== undefined)
          expect(p.bracket.placement.sameContingentByRound[0]).toBe(p.metrics['minSameContingentRound1']);
  });

  it('manual seeds keep their slot (INV-08) for every seed', () => {
    const prestasi = out.categories.find(
      (c) => c.templateCode === 'KYORUGI_PRESTASI' || c.templateCode.startsWith('POOMSAE_PRESTASI'),
    );
    expect(prestasi).toBeDefined();
    const target = prestasi?.entryIds[0] ?? '';
    const seeded = entries.map((e) => (e.entryId === target ? { ...e, seedNo: 1 } : e));
    for (const s of ['1', '2', '3', '10946']) {
      const r = runDraw(input(seeded, { seed: parseDrawSeed(s), scope: [prestasi?.categoryKey ?? ''] }));
      const pool = r.categories[0]?.pools[0];
      const slot = pool?.bracket.slots.find((x) => x.entryId === target);
      expect(standardRanks(pool?.bracket.size ?? 2)[(slot?.position ?? 1) - 1]).toBe(1);
      expect(slot?.seedNo).toBe(1);
    }
  });

  it('a SIMULATION max-tolerance assumption becomes a hard constraint; the rule set itself stays UNSET', () => {
    const c = out.categories.find((x) => x.entryIds.some((id) => id.startsWith('00000000-0000-8000')));
    const r = runDraw(
      input(entries, {
        scope: [c?.categoryKey ?? ''],
        assumptions: {
          maxTolerances: [
            { policyCode: 'KYORUGI_SEMI_POOL', dimension: 'HEIGHT', ageDivisionCode: null, value: 10 },
          ],
        },
      }),
    );
    expect(r.status).toBe('SAFE');
    for (const p of r.categories[0]?.pools ?? []) expect(p.metrics['rangeHEIGHT']).toBeLessThanOrEqual(10);
    expect(ruleSet.poolPolicies.every((p) => p.tolerances.every((t) => t.max.status === 'UNSET'))).toBe(true);
  });

  it('is deterministic: the same input and seed replay to the same output fingerprint; another seed may differ only in ties', () => {
    const scope = readyScope(out);
    const a = runDraw(input(entries, { scope }));
    expect(a.fingerprints).toEqual(out.fingerprints);
    const b = runDraw(input(entries, { scope, seed: parseDrawSeed('1') }));
    expect(b.status).toBe('SAFE');
  });

  it('refuses a category whose draw format is not implemented (freestyle performance order)', () => {
    const freestyle = runDraw(input(entries)).categories.find((c) => c.templateCode.startsWith('FREESTYLE'));
    if (freestyle)
      expect(freestyle.blockedReasons.map((r) => r.code)).toContain('DRAW_FORMAT_NOT_IMPLEMENTED');
  });
});
