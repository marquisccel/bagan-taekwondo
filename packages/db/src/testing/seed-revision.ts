import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';

import { createDrawRun, executeDrawRun } from '../draw-run-repository.js';
import { persistIntake } from '../intake-repository.js';
import { persistRuleSet } from '../rule-set-repository.js';
import { TEST_NIK_KEYS } from './seed.js';
import type { TestDb } from './test-db.js';

const root = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

export const provisionalRuleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const dirtyCsv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

/** A rule set patched to have no LOCK blockers, so the LOCK/PUBLISH/AMEND lifecycle can be exercised. */
export function lockableRuleSet(rs: RuleSet): RuleSet {
  return {
    ...rs,
    status: 'ACTIVE',
    categoryTemplates: rs.categoryTemplates.map((t) =>
      t.provenance.source === 'TBD' ? { ...t, provenance: { source: 'COMMITTEE' } } : t,
    ),
    poolPolicies: rs.poolPolicies.map((p) => ({
      ...p,
      tolerances: p.tolerances.map((t) =>
        t.max.status === 'UNSET'
          ? { ...t, max: { status: 'NONE' as const, provenance: { source: 'COMMITTEE' as const } } }
          : t,
      ),
    })),
  };
}

/** Persists intake + a SAFE CANDIDATE draw run of the dirty-cases fixture; returns its DRAFT revision 1. */
export async function seedDrawnRevision(
  db: TestDb,
  ctx: { tournamentId: string; actorId: string },
  rs: RuleSet = provisionalRuleSet,
  bytes: Uint8Array = dirtyCsv,
): Promise<{ revisionId: string; drawRunId: string }> {
  const persisted = await db.transaction((tx) =>
    persistRuleSet(tx, { tournamentId: ctx.tournamentId, actorId: ctx.actorId, ruleSet: rs }),
  );
  const intake = runIntake({ sourceName: 'seed.csv', bytes, ruleSet: rs });
  if (!intake.snapshot) throw new Error('no snapshot');
  const entries = intake.snapshot.entries;
  const saved = await db.transaction((tx) =>
    persistIntake(tx, {
      tournamentId: ctx.tournamentId,
      ruleSetId: persisted.ruleSetId,
      actorId: ctx.actorId,
      result: intake,
      nikKeys: TEST_NIK_KEYS,
      mode: 'INITIAL',
    }),
  );
  const plan = runDraw({
    engineVersion: ENGINE_VERSION,
    purpose: 'CANDIDATE',
    seed: parseDrawSeed('20260827'),
    ruleSet: rs,
    entries,
    scope: [],
    assumptions: null,
  });
  const scope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
  const created = await db.transaction((tx) =>
    createDrawRun(tx, {
      tournamentId: ctx.tournamentId,
      ruleSetId: persisted.ruleSetId,
      ruleSetSnapshot: rs,
      ruleSetFingerprint: persisted.fingerprint,
      intakeSnapshotId: saved.snapshotId,
      intakeEntries: entries,
      kind: 'CANDIDATE',
      seed: '20260827',
      scope,
      assumptions: null,
      requestedBy: ctx.actorId,
    }),
  );
  const exec = await executeDrawRun(db, created.drawRunId);
  if (exec.output?.status !== 'SAFE') throw new Error('expected SAFE draw run');
  const [rev] = await db.query<{ id: string }>(`select id from draw_revision where draw_run_id = $1`, [
    created.drawRunId,
  ]);
  return { revisionId: rev?.id ?? '', drawRunId: created.drawRunId };
}

export interface SyntheticAthlete {
  readonly name: string;
  readonly contingent: string;
  readonly heightCm: number;
  readonly weightKg: number;
  /** Source label, e.g. 'GEUP 9 - KUNING'. */
  readonly belt: string;
}

/**
 * A registration export of KYORUGI SEMI PRESTASI / CADET / male / class -49 individuals with exactly
 * the given physical values (valid NIK format, unique ids) — for scenarios that need to control what
 * the pools look like. Every value is invented.
 */
export function kyorugiSemiCsv(athletes: readonly SyntheticAthlete[]): Uint8Array {
  const header =
    'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen';
  const rows = athletes.map((a, i) => {
    const day = 10 + i;
    const dd = String(day).padStart(2, '0');
    const nik = `357801${dd}0513${String(i + 1).padStart(4, '0')}`;
    return [
      `SYN${String(i + 1).padStart(3, '0')}`,
      a.contingent,
      nik,
      a.name,
      'Laki-laki',
      `2013-05-${dd}`,
      a.heightCm.toFixed(2),
      a.weightKg.toFixed(2),
      a.belt,
      'KYORUGI SEMI PRESTASI',
      'CADET',
      '-49',
      a.contingent,
    ].join(',');
  });
  return new TextEncoder().encode(`${[header, ...rows].join('\n')}\n`);
}
