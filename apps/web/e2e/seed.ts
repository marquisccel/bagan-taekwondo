import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDrawRun, executeDrawRun, persistIntake, persistRuleSet, poolDb, type Db } from '@bagantkd/db';
import { newArena, newTournament, TEST_NIK_KEYS } from '@bagantkd/db/testing/seed';
import { ENGINE_VERSION, runDraw } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import pg from 'pg';

/** Seeds one SAFE candidate draw run for the E2E workflow spec — the same fixture data and steps
 * apps/api's own contract tests use, just driven from the web app's E2E harness. */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
export const baseRuleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'));

/** Patches the provisional rule set's LOCK blockers so the full lifecycle (through PUBLISH/AMEND) is exercisable. */
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

export interface SeededTournament {
  readonly tournament: string;
  readonly officer: string;
  readonly td: string;
  readonly viewer: string;
  readonly drawRunId: string;
  readonly db: Db;
  close(): Promise<void>;
}

export async function seedTournament(
  databaseUrl: string,
  rs: RuleSet = baseRuleSet,
): Promise<SeededTournament> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const db = poolDb(pool);
  const t = await newTournament(db);
  await newArena(db, t.tournament);
  const persisted = await db.transaction((tx) =>
    persistRuleSet(tx, { tournamentId: t.tournament, actorId: t.officer, ruleSet: rs }),
  );
  const intake = runIntake({ sourceName: 'dirty-cases.csv', bytes: csv, ruleSet: rs });
  if (!intake.snapshot) throw new Error('no snapshot');
  const entries = intake.snapshot.entries;
  const saved = await db.transaction((tx) =>
    persistIntake(tx, {
      tournamentId: t.tournament,
      ruleSetId: persisted.ruleSetId,
      actorId: t.officer,
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
      tournamentId: t.tournament,
      ruleSetId: persisted.ruleSetId,
      ruleSetSnapshot: rs,
      ruleSetFingerprint: persisted.fingerprint,
      intakeSnapshotId: saved.snapshotId,
      intakeEntries: entries,
      kind: 'CANDIDATE',
      seed: '20260827',
      scope,
      assumptions: null,
      requestedBy: t.officer,
    }),
  );
  const exec = await executeDrawRun(db, created.drawRunId);
  if (exec.output?.status !== 'SAFE') throw new Error(`expected SAFE draw run, got ${exec.output?.status}`);
  return {
    tournament: t.tournament,
    officer: t.officer,
    td: t.td,
    viewer: t.viewer,
    drawRunId: created.drawRunId,
    db,
    close: () => pool.end(),
  };
}
