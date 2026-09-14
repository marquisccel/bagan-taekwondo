import {
  computeInputFingerprint,
  DEFAULT_ENGINE_LIMITS,
  ENGINE_VERSION,
  runDraw,
  type CategoryResult,
  type EngineOutput,
  type SimulationAssumptions,
} from '@bagantkd/draw-engine';
import type { SnapshotEntry } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { DomainError, fingerprint, parseDrawSeed } from '@bagantkd/shared';

import type { SqlExecutor } from './intake-repository.js';
import type { Db } from './db.js';

const one = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new DomainError('DRAW_RUN_ROW_MISSING', {}, 'expected row missing');
  return row;
};

// ---------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------

export interface CreateDrawRunArgs {
  readonly tournamentId: string;
  readonly ruleSetId: string;
  readonly ruleSetSnapshot: RuleSet;
  readonly ruleSetFingerprint: string;
  readonly intakeSnapshotId: string;
  readonly intakeEntries: readonly SnapshotEntry[];
  readonly kind: 'SIMULATION' | 'CANDIDATE';
  readonly seed: string;
  readonly scope: readonly string[];
  readonly assumptions: SimulationAssumptions | null;
  readonly requestedBy: string;
}

/**
 * Inserts an immutable `DrawRun` row (status QUEUED). The input fingerprint is computed with the
 * same function the frozen engine uses (`computeInputFingerprint`), so it is fixed before the run
 * ever executes and a replay can be checked against it without re-deriving anything.
 *
 * Enqueueing the job is the caller's job (ADR-0002): this function only writes the row, inside
 * whatever transaction the caller is running, so `createDrawRun` + `enqueue` can be one committed
 * unit. See `apps/worker` for the pg-boss wiring and the reconciliation sweep that recovers a run
 * whose enqueue was lost after this transaction committed.
 */
export async function createDrawRun(
  tx: SqlExecutor,
  args: CreateDrawRunArgs,
): Promise<{ drawRunId: string; inputFingerprint: string }> {
  if (args.kind === 'CANDIDATE' && args.assumptions !== null) {
    throw new DomainError(
      'ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE',
      {},
      'a CANDIDATE run cannot carry simulation assumptions',
    );
  }
  const purpose = args.kind === 'CANDIDATE' ? ('CANDIDATE' as const) : ('SIMULATION' as const);
  const inputFp = computeInputFingerprint({
    engineVersion: ENGINE_VERSION,
    purpose,
    seed: parseDrawSeed(args.seed),
    ruleSet: args.ruleSetSnapshot,
    entries: args.intakeEntries,
    scope: args.scope,
    assumptions: args.assumptions,
  });
  const row = one(
    await tx.query<{ id: string }>(
      `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, seed, engine_version, rules_snapshot, rules_fingerprint, input_fingerprint, params, assumptions, scope, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13) returning id`,
      [
        args.tournamentId,
        args.ruleSetId,
        args.intakeSnapshotId,
        args.kind,
        args.seed,
        ENGINE_VERSION,
        JSON.stringify(args.ruleSetSnapshot),
        args.ruleSetFingerprint,
        inputFp,
        JSON.stringify({ limits: DEFAULT_ENGINE_LIMITS }),
        args.assumptions === null ? null : JSON.stringify(args.assumptions),
        JSON.stringify(args.scope),
        args.requestedBy,
      ],
    ),
  );
  return { drawRunId: row.id, inputFingerprint: inputFp };
}

// ---------------------------------------------------------------------------------------
// Execution (worker side)
// ---------------------------------------------------------------------------------------

interface DrawRunRow {
  readonly id: string;
  readonly tournament_id: string;
  readonly rule_set_id: string;
  readonly kind: 'SIMULATION' | 'CANDIDATE';
  readonly seed: string;
  readonly engine_version: string;
  readonly rules_snapshot: RuleSet;
  readonly scope: string[];
  readonly assumptions: SimulationAssumptions | null;
  readonly requested_by: string;
  readonly status: string;
}

/**
 * Atomically claims one QUEUED run for execution (`UPDATE ... WHERE status = 'QUEUED'`). Concurrent
 * claimants (two worker processes, or a retry racing the original attempt) can only have one
 * succeed: Postgres row-level locking makes the second claimant's UPDATE match zero rows once the
 * first commits. Returns `null` if the run was already claimed, or does not exist.
 */
export async function claimQueuedDrawRun(db: Db, drawRunId: string): Promise<DrawRunRow | null> {
  const rows = await db.query<DrawRunRow>(
    `update draw_run set status = 'RUNNING', started_at = now() where id = $1 and status = 'QUEUED' returning *`,
    [drawRunId],
  );
  return rows[0] ?? null;
}

/** QUEUED runs older than `staleMs` — either the enqueue message was lost, or a worker crashed before claiming. */
export async function findStaleQueuedRuns(db: Db, staleMs: number): Promise<readonly string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from draw_run where status = 'QUEUED' and requested_at < now() - ($1 || ' milliseconds')::interval order by requested_at`,
    [staleMs],
  );
  return rows.map((r) => r.id);
}

/**
 * RUNNING runs whose worker died mid-execution (never reached SAFE/UNSAFE/FAILED). Not
 * re-claimable — the guard only allows QUEUED→RUNNING→{SAFE,UNSAFE,FAILED}, never RUNNING→QUEUED,
 * and a crashed worker's own transaction never committed, so nothing partial was persisted. The
 * correct recovery is `failStuckDrawRun`, which closes the row out as FAILED with a stable reason;
 * the caller creates a fresh DrawRun if the draw is still wanted.
 */
export async function findStuckRunningDrawRuns(db: Db, staleMs: number): Promise<readonly string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from draw_run where status = 'RUNNING' and started_at < now() - ($1 || ' milliseconds')::interval order by started_at`,
    [staleMs],
  );
  return rows.map((r) => r.id);
}

/**
 * Closes a stuck RUNNING run (found by `findStuckRunningDrawRuns`) out as FAILED, atomically
 * guarded so only one reconciler wins if two race on the same orphan. Returns `true` if this call
 * performed the transition, `false` if the row had already left RUNNING by the time it ran.
 */
export async function failStuckDrawRun(db: Db, drawRunId: string, reason: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `update draw_run set status = 'FAILED', unsafe_reasons = $2::jsonb, finished_at = now() where id = $1 and status = 'RUNNING' returning id`,
    [drawRunId, JSON.stringify([{ code: 'WORKER_TIMEOUT', params: { reason } }])],
  );
  return rows.length > 0;
}

const categoryKeyParts = (key: string): { movement: string | null } => {
  const m = /\|MOVEMENT=([^|]*)/.exec(key);
  return { movement: m?.[1] ?? null };
};

async function ensureCategory(
  tx: SqlExecutor,
  args: {
    ruleSetId: string;
    category: CategoryResult;
    sample: SnapshotEntry;
    templateIdByCode: ReadonlyMap<string, string>;
    ageDivisionIdByCode: ReadonlyMap<string, string>;
    weightClassIdByKey: ReadonlyMap<string, string>;
  },
): Promise<string> {
  const { category: c, sample } = args;
  const templateId = args.templateIdByCode.get(c.templateCode);
  const ageDivisionId = args.ageDivisionIdByCode.get(sample.ageDivisionCode);
  if (!templateId || !ageDivisionId) {
    throw new DomainError('CATEGORY_TEMPLATE_UNRESOLVED', {
      categoryKey: c.categoryKey,
      templateCode: c.templateCode,
    });
  }
  const weightClassId = sample.weightClassCode
    ? (args.weightClassIdByKey.get(
        `${sample.stream}|${sample.ageDivisionCode}|${sample.categoryGender === 'MIXED' ? 'MALE' : sample.categoryGender}|${sample.weightClassCode}`,
      ) ?? null)
    : null;
  const { movement } = categoryKeyParts(c.categoryKey);
  const existing = await tx.query<{ id: string }>(
    `select id from category where rule_set_id = $1 and category_key = $2`,
    [args.ruleSetId, c.categoryKey],
  );
  if (existing[0]) return existing[0].id;
  const row = one(
    await tx.query<{ id: string }>(
      `insert into category (tournament_id, rule_set_id, template_id, category_key, stream, discipline, format, age_division_id, gender, weight_class_id, movement)
       select tournament_id, id, $2, $3, $4, $5, $6, $7, $8, $9, $10 from rule_set where id = $1
       on conflict (rule_set_id, category_key) do nothing returning id`,
      [
        args.ruleSetId,
        templateId,
        c.categoryKey,
        sample.stream,
        sample.discipline,
        sample.format,
        ageDivisionId,
        sample.categoryGender,
        weightClassId,
        movement,
      ],
    ),
  );
  if (row.id) return row.id;
  return one(
    await tx.query<{ id: string }>(`select id from category where rule_set_id = $1 and category_key = $2`, [
      args.ruleSetId,
      c.categoryKey,
    ]),
  ).id;
}

async function persistRevisionContent(
  tx: SqlExecutor,
  args: {
    revisionId: string;
    out: EngineOutput;
    categoryIdByKey: ReadonlyMap<string, string>;
    entryDbIdByExternalRef: ReadonlyMap<string, string>;
    entryByEngineId: ReadonlyMap<string, SnapshotEntry>;
  },
): Promise<void> {
  const dbEntryId = (engineEntryId: string): string | null => {
    const ref = args.entryByEngineId.get(engineEntryId)?.externalRef;
    return ref ? (args.entryDbIdByExternalRef.get(ref) ?? null) : null;
  };
  for (const c of args.out.categories) {
    if (c.readiness !== 'READY') continue;
    const categoryId = args.categoryIdByKey.get(c.categoryKey);
    if (!categoryId) throw new DomainError('CATEGORY_MISSING_FOR_POOL', { categoryKey: c.categoryKey });
    for (const p of c.pools) {
      const pool = one(
        await tx.query<{ id: string }>(
          `insert into pool (revision_id, pool_uid, category_id, ordinal, is_walkover, metrics, explanation) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`,
          [
            args.revisionId,
            p.poolUid,
            categoryId,
            p.ordinal,
            p.isWalkover,
            JSON.stringify(p.metrics),
            JSON.stringify(p.reasons),
          ],
        ),
      );
      for (const entryId of p.entryIds) {
        const eid = dbEntryId(entryId);
        if (!eid) throw new DomainError('ENTRY_NOT_FOUND_FOR_POOL_MEMBER', { entryId });
        await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
          pool.id,
          args.revisionId,
          eid,
        ]);
      }
      const bracket = one(
        await tx.query<{ id: string }>(
          `insert into bracket (pool_id, revision_id, size, rounds, entries, byes) values ($1,$2,$3,$4,$5,$6) returning id`,
          [pool.id, args.revisionId, p.bracket.size, p.bracket.rounds, p.bracket.entries, p.bracket.byes],
        ),
      );
      for (const slot of p.bracket.slots) {
        await tx.query(
          `insert into bracket_slot (bracket_id, position, entry_id, seed_no, bye_reason) values ($1,$2,$3,$4,$5::jsonb)`,
          [
            bracket.id,
            slot.position,
            slot.entryId ? dbEntryId(slot.entryId) : null,
            slot.seedNo,
            slot.byeReason ? JSON.stringify(slot.byeReason) : null,
          ],
        );
      }
      const matchIdByRoundPosition = new Map<string, string>();
      for (const m of [...p.bracket.matches].sort((a, b) => a.round - b.round || a.position - b.position)) {
        const feederASlot = 'slot' in m.feederA ? m.feederA.slot : null;
        const feederAMatchId =
          'match' in m.feederA
            ? (matchIdByRoundPosition.get(`${m.round - 1}:${m.feederA.match}`) ?? null)
            : null;
        const feederBSlot = 'slot' in m.feederB ? m.feederB.slot : null;
        const feederBMatchId =
          'match' in m.feederB
            ? (matchIdByRoundPosition.get(`${m.round - 1}:${m.feederB.match}`) ?? null)
            : null;
        const row = one(
          await tx.query<{ id: string }>(
            `insert into match (revision_id, match_uid, bracket_id, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, status)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
            [
              args.revisionId,
              m.matchUid,
              bracket.id,
              m.round,
              m.position,
              feederASlot,
              feederAMatchId,
              feederBSlot,
              feederBMatchId,
              m.real ? 'PENDING' : 'WALKOVER',
            ],
          ),
        );
        matchIdByRoundPosition.set(`${m.round}:${m.position}`, row.id);
      }
    }
  }
}

export interface ExecuteDrawRunResult {
  readonly claimed: boolean;
  readonly output?: EngineOutput;
}

/**
 * Runs the frozen engine and persists its output transactionally: either the whole result
 * (categories, candidates, and — if SAFE — revision 1 with its pools/brackets/matches and a
 * quality report) is committed together with the run's final status, or none of it is.
 *
 * Idempotent / worker-restart-safe: `claimQueuedDrawRun` only succeeds once per run, so a retry
 * (duplicate delivery, or a reconciliation sweep re-picking up a run whose enqueue message was
 * lost) that arrives after another worker already claimed it is a safe no-op (`claimed: false`).
 */
export async function executeDrawRun(db: Db, drawRunId: string): Promise<ExecuteDrawRunResult> {
  const claimed = await claimQueuedDrawRun(db, drawRunId);
  if (!claimed) return { claimed: false };

  const rs = claimed.rules_snapshot;
  const [snap] = await db.query<{ content: { entries: SnapshotEntry[] } }>(
    `select s.content from draw_run r join intake_snapshot s on s.id = r.intake_snapshot_id where r.id = $1`,
    [drawRunId],
  );
  const engineEntries = snap?.content.entries ?? [];

  const purpose = claimed.kind === 'CANDIDATE' ? ('CANDIDATE' as const) : ('SIMULATION' as const);
  const run = (seed: string) =>
    runDraw({
      engineVersion: claimed.engine_version,
      purpose,
      seed: parseDrawSeed(seed),
      ruleSet: rs,
      entries: engineEntries,
      scope: claimed.scope,
      assumptions: claimed.assumptions,
    });

  const started = Date.now();
  const out = run(claimed.seed);
  let dualRunMatch: boolean | null = null;
  if (claimed.kind === 'CANDIDATE') {
    const out2 = run(claimed.seed);
    dualRunMatch = out.fingerprints.output === out2.fingerprints.output;
  }
  const durationMs = Date.now() - started;

  await db.transaction(async (tx) => {
    const [current] = await tx.query<{ status: string }>(
      `select status from draw_run where id = $1 for update`,
      [drawRunId],
    );
    if (current?.status !== 'RUNNING') return; // finished by someone else already; nothing to do

    if (out.status === 'FAILED') {
      await tx.query(
        `update draw_run set status = 'FAILED', unsafe_reasons = $2::jsonb, duration_ms = $3, finished_at = now() where id = $1`,
        [
          drawRunId,
          JSON.stringify([
            {
              code: out.failure?.code ?? 'ENGINE_INTERNAL_ERROR',
              params: { message: out.failure?.message ?? '' },
            },
          ]),
          durationMs,
        ],
      );
      return;
    }

    const templates = await tx.query<{ id: string; code: string }>(
      `select id, code from rule_category_template where rule_set_id = $1`,
      [claimed.rule_set_id],
    );
    const templateIdByCode = new Map(templates.map((t) => [t.code, t.id]));
    const ageDivisions = await tx.query<{ id: string; code: string }>(
      `select id, code from rule_age_division where rule_set_id = $1`,
      [claimed.rule_set_id],
    );
    const ageDivisionIdByCode = new Map(ageDivisions.map((d) => [d.code, d.id]));
    const weightClasses = await tx.query<{ id: string; key: string }>(
      `select rwc.id, rwct.stream || '|' || rad.code || '|' || rwct.gender || '|' || rwc.code as key
       from rule_weight_class rwc join rule_weight_class_table rwct on rwc.table_id = rwct.id join rule_age_division rad on rwct.age_division_id = rad.id
       where rwct.rule_set_id = $1`,
      [claimed.rule_set_id],
    );
    const weightClassIdByKey = new Map(weightClasses.map((w) => [w.key, w.id]));
    const entryByEngineId = new Map(engineEntries.map((e) => [e.entryId, e]));
    const externalRefs = engineEntries.map((e) => e.externalRef);
    const entryRows =
      externalRefs.length === 0
        ? []
        : await tx.query<{ id: string; external_ref: string }>(
            `select id, external_ref from entry where tournament_id = $1 and external_ref = any($2::text[])`,
            [claimed.tournament_id, externalRefs],
          );
    const entryDbIdByExternalRef = new Map(entryRows.map((r) => [r.external_ref, r.id]));

    const categoryIdByKey = new Map<string, string>();
    for (const c of out.categories) {
      const sampleId = c.entryIds[0] ?? c.withheldEntryIds[0];
      const sample = sampleId ? entryByEngineId.get(sampleId) : undefined;
      if (!sample) continue;
      const categoryId = await ensureCategory(tx, {
        ruleSetId: claimed.rule_set_id,
        category: c,
        sample,
        templateIdByCode,
        ageDivisionIdByCode,
        weightClassIdByKey,
      });
      categoryIdByKey.set(c.categoryKey, categoryId);
      await tx.query(
        `insert into draw_run_category (draw_run_id, category_id, readiness, blocked_reasons, selected_strategy) values ($1,$2,$3,$4::jsonb,$5)`,
        [
          drawRunId,
          categoryId,
          c.readiness,
          JSON.stringify(c.blockedReasons),
          c.candidates.find((k) => k.selected)?.strategy ?? null,
        ],
      );
      for (const cand of c.candidates) {
        await tx.query(
          `insert into pool_candidate (draw_run_id, category_id, strategy, rank, selected, tier0_violations, tier1_cost_fp, tier2_cost_fp, partition, metrics)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
          [
            drawRunId,
            categoryId,
            cand.strategy,
            cand.rank,
            cand.selected,
            cand.tier0Violations,
            cand.tier1CostFp,
            cand.tier2CostFp,
            JSON.stringify(cand.partition),
            JSON.stringify(cand.metrics),
          ],
        );
      }
      for (const engineEntryId of [...c.entryIds, ...c.withheldEntryIds]) {
        const ref = entryByEngineId.get(engineEntryId)?.externalRef;
        const dbId = ref ? entryDbIdByExternalRef.get(ref) : undefined;
        if (dbId) await tx.query(`update entry set category_id = $1 where id = $2`, [categoryId, dbId]);
      }
    }

    if (out.status === 'UNSAFE') {
      await tx.query(
        `update draw_run set status = 'UNSAFE', unsafe_reasons = $2::jsonb, duration_ms = $3, finished_at = now() where id = $1`,
        [drawRunId, JSON.stringify(out.unsafeReasons), durationMs],
      );
      return;
    }

    const revision = one(
      await tx.query<{ id: string }>(
        `insert into draw_revision (tournament_id, draw_run_id, revision_no, lifecycle, created_by) values ($1,$2,1,'DRAFT',$3) returning id`,
        [claimed.tournament_id, drawRunId, claimed.requested_by],
      ),
    );
    await persistRevisionContent(tx, {
      revisionId: revision.id,
      out,
      categoryIdByKey,
      entryDbIdByExternalRef,
      entryByEngineId,
    });

    const errorCount = out.quality.findings.filter((f) => f.level === 'ERROR').length;
    const warningCount = out.quality.findings.filter((f) => f.level === 'WARNING').length;
    const infoCount = out.quality.findings.filter((f) => f.level === 'INFO').length;
    await tx.query(
      `insert into quality_report (draw_run_id, report, fingerprint, error_count, warning_count, info_count) values ($1,$2::jsonb,$3,$4,$5,$6)`,
      [drawRunId, JSON.stringify(out.quality), fingerprint(out.quality), errorCount, warningCount, infoCount],
    );

    await tx.query(
      `update draw_run set status = 'SAFE', output_fingerprint = $2, dual_run_match = $3, duration_ms = $4, finished_at = now() where id = $1`,
      [drawRunId, out.fingerprints.output, dualRunMatch, durationMs],
    );
  });

  return { claimed: true, output: out };
}
