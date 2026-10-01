import {
  acceptsDrawCommands,
  canPerformCommand,
  canPerformLifecycle,
  isContentFrozen,
  nextLifecycle,
  type ConstraintVerdict,
  type DrawCommand,
  type Role,
} from '@bagantkd/domain';
import {
  buildBracket,
  checkBracket,
  evaluatePoolChange,
  resolvePolicy,
  type BracketEntry,
  type PoolEntry,
} from '@bagantkd/draw-engine';
import { assessRuleSet, type RuleSet } from '@bagantkd/rules';
import {
  compareStrings,
  deterministicUuid,
  DomainError,
  fingerprint,
  parseDrawSeed,
  sortedBy,
} from '@bagantkd/shared';

import { appendAuditEvent, isAuditChainRace, tournamentChainKey } from './audit-repository.js';
import type { Db } from './db.js';
import type { SqlExecutor } from './intake-repository.js';

/**
 * Every expected backend failure has a stable code (Phase 4 hardening §3). Thrown only for
 * programmer/integration errors (missing row where one is guaranteed); business rejections are
 * returned as `{outcome: 'REJECTED', rejectionCode}`, never thrown, so the caller's transaction
 * still commits the `draw_command` audit row for the rejection.
 */
export const COMMAND_ERROR_CODES = [
  'REVISION_NOT_FOUND',
  'UNAUTHORIZED_TOURNAMENT_ACCESS',
  'FORBIDDEN_COMMAND',
  'REVISION_LOCKED',
  'REVISION_CONFLICT',
  'INVALID_COMMAND',
  'ENTRY_NOT_FOUND',
  'POOL_NOT_FOUND',
  'RULE_SET_NOT_READY',
  'IDEMPOTENCY_CONFLICT',
  /** AUD-005: a pool-changing command would introduce a hard (Tier 0) rule violation. */
  'HARD_CONSTRAINT_VIOLATED',
  /** AUD-005: a valid command that degrades soft quality was sent without an operator reason. */
  'REASON_REQUIRED',
  /** AUD-007: the rebuilt bracket failed a structural invariant; the whole command is rolled back. */
  'BRACKET_INVARIANT_VIOLATED',
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export interface CommandActor {
  readonly userId: string;
  readonly role: Role;
}

export interface CommandOutcome {
  readonly outcome: 'APPLIED' | 'REJECTED';
  readonly rejectionCode: CommandErrorCode | null;
  readonly verdict: ConstraintVerdict;
  readonly resultingRevisionId: string | null;
  readonly commandRowId: string;
  readonly replayed: boolean;
}

const RED = (hardViolations: readonly string[]): ConstraintVerdict => ({ level: 'RED', hardViolations });
const GREEN: ConstraintVerdict = { level: 'GREEN' };

/** Thrown to abort the whole transaction (including the lock_version CAS) after a content-validation failure. */
class ContentRejected extends Error {
  constructor(
    readonly code: CommandErrorCode,
    readonly hard: readonly string[],
    /** The verdict to persist for the rejection; defaults to RED(hard). */
    readonly verdict: ConstraintVerdict | null = null,
  ) {
    super(code);
  }
}

interface RevisionRow {
  readonly id: string;
  readonly tournament_id: string;
  readonly draw_run_id: string;
  readonly lifecycle: string;
  readonly lock_version: number;
  readonly parent_revision_id: string | null;
  readonly revision_no: number;
}

async function loadRevision(tx: SqlExecutor, revisionId: string): Promise<RevisionRow | null> {
  const [row] = await tx.query<RevisionRow>(`select * from draw_revision where id = $1`, [revisionId]);
  return row ?? null;
}

/**
 * Swaps two entries' positions within an already-built bracket, in place -- used for a same-pool
 * SWAP_ENTRIES (dragging one athlete onto another inside the Bracket tab), as opposed to
 * `rebuildPoolBracket`'s full re-derivation from the pool's member set and the draw's seed.
 *
 * Why this has to exist separately: a same-pool swap leaves `pool_member` completely unchanged (the
 * same two entries are still members of the same pool, just in a different arrangement), so
 * `buildBracket` -- a pure function of the entry set, seed and label -- would deterministically
 * reproduce the exact same bracket every time it's asked to rebuild this pool. The operator's actual
 * intent, dragging entry A onto entry B's spot, is "exchange where these two sit", which only a
 * targeted slot swap (not a from-scratch rebuild) can express. This is also why this bug could only
 * ever show its first drag-and-drop as "working": that lone rebuild differed from the ORIGINAL
 * draw-time bracket (different seed derivation -- draw.ts uses a relative seed, this path a raw
 * one), and every rebuild after that first one reproduced that same new-but-now-stable layout with no
 * further visible change, matching the "only works once" bug report exactly.
 *
 * `match` rows reference bracket position (`feeder_a_slot`/`feeder_b_slot`), never `entry_id`
 * directly, so swapping who occupies a position is the entire change -- no match/bracket_slot
 * structure needs touching. The two rows are deleted and reinserted (rather than updated in place)
 * because `bracket_slot` has a `UNIQUE(bracket_id, entry_id)` constraint that isn't deferrable: two
 * sequential UPDATEs would collide the instant one row briefly holds the other's entry_id.
 *
 * Returns false (never throws) when either entry has no bracket_slot yet -- the caller treats that
 * as ENTRY_NOT_FOUND, since there is nothing in the bracket to swap.
 */
async function swapBracketSlots(
  tx: SqlExecutor,
  poolId: string,
  entryA: string,
  entryB: string,
): Promise<boolean> {
  const [bracket] = await tx.query<{ id: string }>(`select id from bracket where pool_id = $1`, [poolId]);
  if (!bracket) return false;
  const slots = await tx.query<{ position: number; entry_id: string | null; seed_no: number | null }>(
    `select position, entry_id, seed_no from bracket_slot where bracket_id = $1 and entry_id in ($2, $3)`,
    [bracket.id, entryA, entryB],
  );
  const slotA = slots.find((s) => s.entry_id === entryA);
  const slotB = slots.find((s) => s.entry_id === entryB);
  if (!slotA || !slotB) return false;

  await tx.query(`delete from bracket_slot where bracket_id = $1 and position in ($2, $3)`, [
    bracket.id,
    slotA.position,
    slotB.position,
  ]);
  await tx.query(
    `insert into bracket_slot (bracket_id, position, entry_id, seed_no, bye_reason) values
       ($1, $2, $3, $4, null),
       ($1, $5, $6, $7, null)`,
    [bracket.id, slotA.position, entryB, slotB.seed_no, slotB.position, entryA, slotA.seed_no],
  );
  return true;
}

/** Rebuilds one pool's bracket (frozen engine functions; no algorithm change) from its current members. */
async function rebuildPoolBracket(
  tx: SqlExecutor,
  args: { revisionId: string; poolId: string; seed: string; budgetPerEntry: number },
): Promise<void> {
  const [pool] = await tx.query<{ ordinal: number; category_key: string; bye_policy: string | null }>(
    `select p.ordinal, c.category_key, t.bye_policy
     from pool p join category c on c.id = p.category_id join draw_run r on r.id = (select draw_run_id from draw_revision where id = $2)
     join rule_category_template t on t.rule_set_id = c.rule_set_id and t.code = (select code from rule_category_template where id = c.template_id)
     where p.id = $1`,
    [args.poolId, args.revisionId],
  );
  const [run] = await tx.query<{ rules_snapshot: RuleSet }>(
    `select rules_snapshot from draw_run where id = (select draw_run_id from draw_revision where id = $1)`,
    [args.revisionId],
  );
  const beltRankByCode = new Map((run?.rules_snapshot.belts ?? []).map((b) => [b.code, b.rank]));
  const members = await tx.query<{
    entry_id: string;
    seed_no: number | null;
    contingent: string;
    belt_code: string | null;
  }>(
    `select e.id as entry_id, e.seed_no, con.name as contingent, a.registered_belt_code as belt_code
     from pool_member pm
     join entry e on e.id = pm.entry_id
     join contingent con on con.id = e.contingent_id
     left join lateral (
       select at.registered_belt_code
       from entry_member em join athlete at on at.id = em.athlete_id
       where em.entry_id = e.id order by em.position limit 1
     ) a on true
     where pm.pool_id = $1`,
    [args.poolId],
  );
  if (members.length === 0) {
    await tx.query(`delete from match where bracket_id in (select id from bracket where pool_id = $1)`, [
      args.poolId,
    ]);
    await tx.query(
      `delete from bracket_slot where bracket_id in (select id from bracket where pool_id = $1)`,
      [args.poolId],
    );
    await tx.query(`delete from bracket where pool_id = $1`, [args.poolId]);
    await tx.query(`update pool set is_walkover = false where id = $1`, [args.poolId]);
    return;
  }
  const entries: BracketEntry[] = members.map((m) => ({
    id: m.entry_id,
    contingent: m.contingent,
    seedNo: m.seed_no,
    beltRank: m.belt_code ? (beltRankByCode.get(m.belt_code) ?? null) : null,
  }));
  const categoryKey = pool?.category_key ?? '';
  const ordinal = pool?.ordinal ?? 1;
  const built = buildBracket({
    entries,
    seed: parseDrawSeed(args.seed),
    label: `${categoryKey}#${ordinal}`,
    byePolicy: pool?.bye_policy ?? 'SEED_PRIORITY',
    budgetPerEntry: args.budgetPerEntry,
  });
  const violations = checkBracket(built, entries);
  if (violations.length > 0) {
    // An expected, stable rejection (AUD-007): the transaction rolls back (no partial mutation) and
    // the rejection is recorded; the raw detail never reaches the client.
    throw new ContentRejected(
      'BRACKET_INVARIANT_VIOLATED',
      violations.map((v) => v.code),
    );
  }
  await tx.query(`delete from match where bracket_id in (select id from bracket where pool_id = $1)`, [
    args.poolId,
  ]);
  await tx.query(`delete from bracket_slot where bracket_id in (select id from bracket where pool_id = $1)`, [
    args.poolId,
  ]);
  await tx.query(`delete from bracket where pool_id = $1`, [args.poolId]);
  const [bracket] = await tx.query<{ id: string }>(
    `insert into bracket (pool_id, revision_id, size, rounds, entries, byes) values ($1,$2,$3,$4,$5,$6) returning id`,
    [args.poolId, args.revisionId, built.size, built.rounds, built.entries, built.byes],
  );
  const bracketId = bracket?.id ?? '';
  for (const slot of built.slots) {
    await tx.query(
      `insert into bracket_slot (bracket_id, position, entry_id, seed_no, bye_reason) values ($1,$2,$3,$4,$5::jsonb)`,
      [
        bracketId,
        slot.position,
        slot.entryId,
        slot.seedNo,
        slot.byeReason ? JSON.stringify(slot.byeReason) : null,
      ],
    );
  }
  const matchIdByRoundPosition = new Map<string, string>();
  for (const m of [...built.matches].sort((a, b) => a.round - b.round || a.position - b.position)) {
    const matchUid = deterministicUuid(
      'bagantkd/match',
      `${categoryKey}|${ordinal}|${m.round}|${m.position}`,
    );
    const feederASlot = 'slot' in m.feederA ? m.feederA.slot : null;
    const feederAMatchId =
      'match' in m.feederA ? (matchIdByRoundPosition.get(`${m.round - 1}:${m.feederA.match}`) ?? null) : null;
    const feederBSlot = 'slot' in m.feederB ? m.feederB.slot : null;
    const feederBMatchId =
      'match' in m.feederB ? (matchIdByRoundPosition.get(`${m.round - 1}:${m.feederB.match}`) ?? null) : null;
    const [row] = await tx.query<{ id: string }>(
      `insert into match (revision_id, match_uid, bracket_id, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        args.revisionId,
        matchUid,
        bracketId,
        m.round,
        m.position,
        feederASlot,
        feederAMatchId,
        feederBSlot,
        feederBMatchId,
        m.real ? 'PENDING' : 'WALKOVER',
      ],
    );
    matchIdByRoundPosition.set(`${m.round}:${m.position}`, row?.id ?? '');
  }
  await tx.query(`update pool set is_walkover = $2 where id = $1`, [args.poolId, entries.length === 1]);
}

async function poolOfEntry(
  tx: SqlExecutor,
  revisionId: string,
  entryId: string,
): Promise<{ poolId: string; categoryId: string } | null> {
  const [row] = await tx.query<{ pool_id: string; category_id: string }>(
    `select p.id as pool_id, p.category_id from pool_member pm join pool p on p.id = pm.pool_id where pm.revision_id = $1 and pm.entry_id = $2`,
    [revisionId, entryId],
  );
  return row ? { poolId: row.pool_id, categoryId: row.category_id } : null;
}

async function drawRunOf(
  tx: SqlExecutor,
  revisionId: string,
): Promise<{ seed: string; budgetPerEntry: number }> {
  const [row] = await tx.query<{ seed: string }>(
    `select r.seed from draw_run r join draw_revision v on v.draw_run_id = r.id where v.id = $1`,
    [revisionId],
  );
  return { seed: row?.seed ?? '0', budgetPerEntry: 200 };
}

/** Content-mutating handlers. Each returns the pool ids it touched, for bracket rebuilding. */
async function applyContent(
  tx: SqlExecutor,
  rev: RevisionRow,
  cmd: DrawCommand,
): Promise<{ touchedPools: string[] } | { rejected: CommandErrorCode; hard: string[] }> {
  switch (cmd.type) {
    case 'MOVE_ENTRY': {
      const from = await poolOfEntry(tx, rev.id, cmd.entryId);
      if (!from)
        return { rejected: 'ENTRY_NOT_FOUND', hard: [`entry ${cmd.entryId} is not in this revision`] };
      const [to] = await tx.query<{ id: string; category_id: string }>(
        `select id, category_id from pool where revision_id = $1 and pool_uid = $2`,
        [rev.id, cmd.toPoolUid],
      );
      if (!to)
        return { rejected: 'POOL_NOT_FOUND', hard: [`pool ${cmd.toPoolUid} not found in this revision`] };
      if (to.category_id !== from.categoryId)
        return { rejected: 'INVALID_COMMAND', hard: ['MOVE_ENTRY cannot cross categories'] };
      if (to.id === from.poolId) return { touchedPools: [from.poolId] };
      await tx.query(`delete from pool_member where pool_id = $1 and entry_id = $2`, [
        from.poolId,
        cmd.entryId,
      ]);
      await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
        to.id,
        rev.id,
        cmd.entryId,
      ]);
      return { touchedPools: [from.poolId, to.id] };
    }
    case 'SWAP_ENTRIES': {
      const a = await poolOfEntry(tx, rev.id, cmd.entryA);
      const b = await poolOfEntry(tx, rev.id, cmd.entryB);
      if (!a || !b) return { rejected: 'ENTRY_NOT_FOUND', hard: ['both entries must be in this revision'] };
      if (a.poolId === b.poolId) {
        // Same pool: pool_member has nothing to change (see swapBracketSlots' own comment for why a
        // rebuild from here would be a deterministic no-op) -- swap the two bracket positions
        // directly instead, and skip rebuildPoolBracket entirely for this pool (touchedPools: []),
        // since a rebuild immediately after would overwrite the swap we just made.
        const swapped = await swapBracketSlots(tx, a.poolId, cmd.entryA, cmd.entryB);
        if (!swapped)
          return {
            rejected: 'ENTRY_NOT_FOUND',
            hard: ['no bracket exists yet for this pool -- nothing to swap'],
          };
        return { touchedPools: [] };
      }
      await tx.query(`delete from pool_member where pool_id = $1 and entry_id = $2`, [a.poolId, cmd.entryA]);
      await tx.query(`delete from pool_member where pool_id = $1 and entry_id = $2`, [b.poolId, cmd.entryB]);
      await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
        b.poolId,
        rev.id,
        cmd.entryA,
      ]);
      await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
        a.poolId,
        rev.id,
        cmd.entryB,
      ]);
      return { touchedPools: [a.poolId, b.poolId] };
    }
    case 'ADD_ENTRY': {
      if (!cmd.toPoolUid) return { rejected: 'INVALID_COMMAND', hard: ['ADD_ENTRY requires a target pool'] };
      const existing = await poolOfEntry(tx, rev.id, cmd.entryId);
      if (existing) return { rejected: 'INVALID_COMMAND', hard: ['entry is already placed; use MOVE_ENTRY'] };
      const [to] = await tx.query<{ id: string }>(
        `select id from pool where revision_id = $1 and pool_uid = $2`,
        [rev.id, cmd.toPoolUid],
      );
      if (!to) return { rejected: 'POOL_NOT_FOUND', hard: [`pool ${cmd.toPoolUid} not found`] };
      await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
        to.id,
        rev.id,
        cmd.entryId,
      ]);
      return { touchedPools: [to.id] };
    }
    case 'REMOVE_ENTRY': {
      const from = await poolOfEntry(tx, rev.id, cmd.entryId);
      if (!from)
        return { rejected: 'ENTRY_NOT_FOUND', hard: [`entry ${cmd.entryId} is not in this revision`] };
      await tx.query(`delete from pool_member where pool_id = $1 and entry_id = $2`, [
        from.poolId,
        cmd.entryId,
      ]);
      if (cmd.because !== 'CATEGORY_CHANGE') {
        await tx.query(`update entry set registration_status = $2 where id = $1`, [cmd.entryId, cmd.because]);
      }
      return { touchedPools: [from.poolId] };
    }
    case 'SET_SEED': {
      const [entry] = await tx.query<{ id: string }>(
        `select e.id from entry e join pool_member pm on pm.entry_id = e.id where pm.revision_id = $1 and e.id = $2`,
        [rev.id, cmd.entryId],
      );
      if (!entry)
        return { rejected: 'ENTRY_NOT_FOUND', hard: [`entry ${cmd.entryId} is not in this revision`] };
      await tx.query(`update entry set seed_no = $2 where id = $1`, [cmd.entryId, cmd.seedNo]);
      const p = await poolOfEntry(tx, rev.id, cmd.entryId);
      return { touchedPools: p ? [p.poolId] : [] };
    }
    case 'SET_MATCH_DISPLAY_NO': {
      // Presentation only (FINAL/OFFICIAL bracket sheet numbering) -- never touches bracket
      // structure, quality or the persisted matchUid/publicCode identity, so it never affects pools.
      const [match] = await tx.query<{ id: string }>(
        `select id from match where revision_id = $1 and id = $2`,
        [rev.id, cmd.matchId],
      );
      if (!match)
        return { rejected: 'INVALID_COMMAND', hard: [`match ${cmd.matchId} not found in this revision`] };
      await tx.query(`update match set display_no = $2 where id = $1`, [cmd.matchId, cmd.displayNo]);
      return { touchedPools: [] };
    }
    case 'REGENERATE_POOL': {
      const [pool] = await tx.query<{ id: string }>(
        `select id from pool where revision_id = $1 and pool_uid = $2`,
        [rev.id, cmd.poolUid],
      );
      if (!pool) return { rejected: 'POOL_NOT_FOUND', hard: [`pool ${cmd.poolUid} not found`] };
      return { touchedPools: [pool.id] };
    }
    case 'REGENERATE_CATEGORY': {
      const pools = await tx.query<{ id: string }>(
        `select id from pool where revision_id = $1 and category_id = $2`,
        [rev.id, cmd.categoryId],
      );
      if (pools.length === 0)
        return {
          rejected: 'POOL_NOT_FOUND',
          hard: [`category ${cmd.categoryId} has no pools in this revision`],
        };
      return { touchedPools: pools.map((p) => p.id) };
    }
    case 'MOVE_POOL': {
      const [pool] = await tx.query<{ id: string }>(
        `select id from pool where revision_id = $1 and pool_uid = $2`,
        [rev.id, cmd.poolUid],
      );
      if (!pool) return { rejected: 'POOL_NOT_FOUND', hard: [`pool ${cmd.poolUid} not found`] };
      const [arena] = await tx.query<{ id: string }>(
        `select id from arena where tournament_id = $1 and code = $2`,
        [rev.tournament_id, cmd.toArenaCode],
      );
      if (!arena) return { rejected: 'INVALID_COMMAND', hard: [`arena ${cmd.toArenaCode} does not exist`] };
      await tx.query(
        `update match set arena_id = $2, order_no = $3 where bracket_id in (select id from bracket where pool_id = $1)`,
        [pool.id, arena.id, cmd.toOrder],
      );
      return { touchedPools: [] };
    }
    case 'ACKNOWLEDGE_WARNING': {
      return { touchedPools: [] };
    }
    default:
      return { rejected: 'INVALID_COMMAND', hard: ['unknown command type'] };
  }
}

// ---------------------------------------------------------------------------------------
// AUD-005: canonical quality verdict of MOVE_ENTRY / SWAP_ENTRIES
// ---------------------------------------------------------------------------------------

interface PoolSnapshot {
  readonly poolUid: string;
  readonly entryIds: readonly string[];
}

/** The pools (and their category) a MOVE_ENTRY / SWAP_ENTRIES will change; null when it changes none. */
async function poolsChangedBy(
  tx: SqlExecutor,
  rev: RevisionRow,
  cmd: DrawCommand,
): Promise<{ poolIds: string[]; categoryId: string } | null> {
  if (cmd.type === 'MOVE_ENTRY') {
    const from = await poolOfEntry(tx, rev.id, cmd.entryId);
    const [to] = await tx.query<{ id: string; category_id: string }>(
      `select id, category_id from pool where revision_id = $1 and pool_uid = $2`,
      [rev.id, cmd.toPoolUid],
    );
    if (!from || !to || to.id === from.poolId || to.category_id !== from.categoryId) return null;
    return { poolIds: [from.poolId, to.id], categoryId: from.categoryId };
  }
  if (cmd.type === 'SWAP_ENTRIES') {
    const a = await poolOfEntry(tx, rev.id, cmd.entryA);
    const b = await poolOfEntry(tx, rev.id, cmd.entryB);
    if (!a || !b || a.poolId === b.poolId) return null;
    return { poolIds: [a.poolId, b.poolId], categoryId: a.categoryId };
  }
  return null;
}

async function snapshotPools(tx: SqlExecutor, poolIds: readonly string[]): Promise<PoolSnapshot[]> {
  const out: PoolSnapshot[] = [];
  for (const id of poolIds) {
    const [p] = await tx.query<{ pool_uid: string }>(`select pool_uid from pool where id = $1`, [id]);
    const ms = await tx.query<{ entry_id: string }>(
      `select entry_id from pool_member where pool_id = $1 order by entry_id`,
      [id],
    );
    out.push({ poolUid: p?.pool_uid ?? '', entryIds: ms.map((m) => m.entry_id) });
  }
  return out;
}

/** Same values the draw used: registered data of the entry's first member, contingent by name. */
async function loadPoolEntries(
  tx: SqlExecutor,
  entryIds: readonly string[],
  beltRank: ReadonlyMap<string, number>,
): Promise<Map<string, PoolEntry>> {
  const rows = await tx.query<{
    id: string;
    contingent: string;
    weight_g: number | null;
    height_mm: number | null;
    belt_code: string | null;
  }>(
    `select e.id, con.name as contingent, a.registered_weight_g as weight_g,
            a.registered_height_mm as height_mm, a.registered_belt_code as belt_code
     from entry e
     join contingent con on con.id = e.contingent_id
     left join lateral (
       select at.registered_weight_g, at.registered_height_mm, at.registered_belt_code
       from entry_member em join athlete at on at.id = em.athlete_id
       where em.entry_id = e.id order by em.position limit 1
     ) a on true
     where e.id = any($1::uuid[])`,
    [entryIds],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        weightG: r.weight_g,
        heightMm: r.height_mm,
        beltRank: r.belt_code ? (beltRank.get(r.belt_code) ?? null) : null,
        contingent: r.contingent,
      },
    ]),
  );
}

/**
 * The engine's own quality verdict for the change (never re-implemented elsewhere). Null when the
 * category is not pooled (nothing to evaluate) — the command is then simply GREEN.
 */
async function evaluateChange(
  tx: SqlExecutor,
  rev: RevisionRow,
  categoryId: string,
  before: readonly PoolSnapshot[],
  after: readonly PoolSnapshot[],
): Promise<{
  verdict: ConstraintVerdict;
  hard: readonly string[];
  soft: readonly string[];
} | null> {
  const [cat] = await tx.query<{ age_code: string; template_code: string }>(
    `select ad.code as age_code, t.code as template_code
     from category c
     join rule_age_division ad on ad.id = c.age_division_id
     join rule_category_template t on t.id = c.template_id
     where c.id = $1`,
    [categoryId],
  );
  const [run] = await tx.query<{ rules_snapshot: RuleSet }>(
    `select rules_snapshot from draw_run where id = $1`,
    [rev.draw_run_id],
  );
  const rs = run?.rules_snapshot;
  const template = rs?.categoryTemplates?.find((t) => t.code === cat?.template_code);
  if (!cat || !rs || !template || template.drawFormat !== 'POOLED_SINGLE_ELIMINATION') return null;
  const policy = rs.poolPolicies.find((p) => p.code === template.poolPolicyCode);
  if (!policy) return null;

  const beltRank = new Map(rs.belts.map((b) => [b.code, b.rank]));
  const ids = [...new Set([...before, ...after].flatMap((s) => s.entryIds))];
  const entries = await loadPoolEntries(tx, ids, beltRank);
  const pools = (snaps: readonly PoolSnapshot[]) =>
    snaps.map((s) => s.entryIds.flatMap((id) => entries.get(id) ?? []));
  const r = evaluatePoolChange(pools(before), pools(after), resolvePolicy(rs, policy, cat.age_code));
  const impact = {
    change: r.change,
    poolUids: after.map((s) => s.poolUid),
    before: r.before,
    after: r.after,
  };
  const verdict: ConstraintVerdict =
    r.level === 'RED'
      ? { level: 'RED', hardViolations: r.hardViolations, impact }
      : r.level === 'YELLOW'
        ? { level: 'YELLOW', softViolations: r.softViolations, reasonRequired: true, impact }
        : { level: 'GREEN', impact };
  return { verdict, hard: r.hardViolations, soft: r.softViolations };
}

async function insertDrawCommand(
  tx: SqlExecutor,
  args: {
    tournamentId: string;
    revisionId: string;
    resultingRevisionId: string | null;
    cmd: DrawCommand;
    actorId: string;
    outcome: 'APPLIED' | 'REJECTED';
    rejectionCode: string | null;
    verdict: ConstraintVerdict;
  },
): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into draw_command (tournament_id, base_revision_id, resulting_revision_id, type, payload, expected_lock_version, idempotency_key, actor_id, reason, complaint_id, outcome, rejection_code, verdict)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) returning id`,
    [
      args.tournamentId,
      args.revisionId,
      args.resultingRevisionId,
      args.cmd.type,
      JSON.stringify(args.cmd),
      args.cmd.expectedLockVersion,
      args.cmd.idempotencyKey,
      args.actorId,
      args.cmd.reason,
      args.cmd.complaintId,
      args.outcome,
      args.rejectionCode,
      JSON.stringify(args.verdict),
    ],
  );
  return row?.id ?? '';
}

async function applyOnce(tx: SqlExecutor, cmd: DrawCommand, actor: CommandActor): Promise<CommandOutcome> {
  const existing = await tx.query<{
    id: string;
    outcome: 'APPLIED' | 'REJECTED';
    rejection_code: string | null;
    verdict: ConstraintVerdict;
    resulting_revision_id: string | null;
    payload: DrawCommand;
  }>(
    `select id, outcome, rejection_code, verdict, resulting_revision_id, payload from draw_command where tournament_id = (select tournament_id from draw_revision where id = $1) and idempotency_key = $2`,
    [cmd.revisionId, cmd.idempotencyKey],
  );
  if (existing[0]) {
    const e = existing[0];
    // The idempotency key must map to exactly one command body (ADR-0004): reusing it for a
    // genuinely different mutation is a client bug, not a retry, and must not silently replay the
    // original command's outcome.
    if (fingerprint(e.payload) !== fingerprint(cmd)) {
      return {
        outcome: 'REJECTED',
        rejectionCode: 'IDEMPOTENCY_CONFLICT',
        verdict: RED([`idempotency key ${cmd.idempotencyKey} was already used for a different command`]),
        resultingRevisionId: null,
        commandRowId: e.id,
        replayed: false,
      };
    }
    return {
      outcome: e.outcome,
      rejectionCode: (e.rejection_code as CommandErrorCode) ?? null,
      verdict: e.verdict,
      resultingRevisionId: e.resulting_revision_id,
      commandRowId: e.id,
      replayed: true,
    };
  }

  const rev = await loadRevision(tx, cmd.revisionId);
  if (!rev) throw new DomainError('REVISION_NOT_FOUND', { revisionId: cmd.revisionId });

  const reject = async (code: CommandErrorCode, hard: readonly string[]): Promise<CommandOutcome> => {
    const verdict = RED(hard);
    const id = await insertDrawCommand(tx, {
      tournamentId: rev.tournament_id,
      revisionId: rev.id,
      resultingRevisionId: null,
      cmd,
      actorId: actor.userId,
      outcome: 'REJECTED',
      rejectionCode: code,
      verdict,
    });
    return {
      outcome: 'REJECTED',
      rejectionCode: code,
      verdict,
      resultingRevisionId: null,
      commandRowId: id,
      replayed: false,
    };
  };

  const authorized =
    cmd.type === 'LIFECYCLE'
      ? canPerformLifecycle(actor.role, cmd.action)
      : canPerformCommand(actor.role, cmd.type);
  if (!authorized) return reject('FORBIDDEN_COMMAND', [`role ${actor.role} may not issue ${cmd.type}`]);

  // SET_MATCH_DISPLAY_NO is presentation-only (the FINAL/OFFICIAL bracket sheet's printed numbers)
  // and never touches the frozen draw content itself, so it is allowed at any lifecycle stage --
  // the team can still fix a match number after LOCK/PUBLISH, right before generating the PDF.
  if (
    cmd.type !== 'LIFECYCLE' &&
    cmd.type !== 'SET_MATCH_DISPLAY_NO' &&
    !acceptsDrawCommands(rev.lifecycle as never)
  ) {
    return reject('REVISION_LOCKED', [`revision is ${rev.lifecycle}, not DRAFT`]);
  }

  if (cmd.type === 'LIFECYCLE') {
    const to = nextLifecycle(rev.lifecycle as never, cmd.action);
    if (!to) return reject('INVALID_COMMAND', [`${rev.lifecycle} does not accept ${cmd.action}`]);
    // Lock the row and re-verify the expected version now, before any side effect (e.g. SUBMIT's
    // match-code allocation) runs — the row lock is held for the rest of this transaction, so the
    // later single UPDATE (lifecycle + lock_version+1, still keyed on this same expectedLockVersion
    // for defense-in-depth) cannot lose a race with another writer.
    const [locked] = await tx.query<RevisionRow>(`select * from draw_revision where id = $1 for update`, [
      rev.id,
    ]);
    if (!locked || locked.lock_version !== cmd.expectedLockVersion) {
      return reject('REVISION_CONFLICT', [
        `expected lock_version ${cmd.expectedLockVersion}, current is different`,
      ]);
    }
    if (cmd.action === 'LOCK') {
      const [ruleSetRow] = await tx.query<{ rules_snapshot: unknown }>(
        `select rules_snapshot from draw_run where id = $1`,
        [rev.draw_run_id],
      );
      const assessment = assessRuleSet(ruleSetRow?.rules_snapshot, 'LOCK');
      if (!assessment.allowed) {
        return reject(
          'RULE_SET_NOT_READY',
          assessment.findings
            .filter((f) => f.level === 'LOCK_BLOCKER' || f.level === 'INVALID')
            .map((f) => f.code),
        );
      }
    }
    // Exactly ONE update to draw_revision per lifecycle command (the trigger requires every update
    // to bump lock_version by exactly +1): the CAS check and the lifecycle/field change happen in
    // the same statement, keyed on (id, expectedLockVersion).
    let resultingRevisionId = rev.id;
    /** AUD-006: the AMENDED parent retired by this PUBLISH, if any (audited after the publish event). */
    let supersededParentId: string | null = null;
    if (cmd.action === 'LOCK') {
      const fp = fingerprint({ revisionId: rev.id, at: 'lock' });
      const cas = await tx.query<RevisionRow>(
        `update draw_revision set lifecycle = $3, locked_at = now(), locked_by = $4, content_fingerprint = $5, lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
        [rev.id, cmd.expectedLockVersion, to, actor.userId, fp],
      );
      if (cas.length === 0)
        return reject('REVISION_CONFLICT', [
          `expected lock_version ${cmd.expectedLockVersion}, current is different`,
        ]);
    } else if (cmd.action === 'APPROVE') {
      const cas = await tx.query<RevisionRow>(
        `update draw_revision set lifecycle = $3, approved_at = now(), approved_by = $4, lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
        [rev.id, cmd.expectedLockVersion, to, actor.userId],
      );
      if (cas.length === 0)
        return reject('REVISION_CONFLICT', [
          `expected lock_version ${cmd.expectedLockVersion}, current is different`,
        ]);
    } else if (cmd.action === 'PUBLISH') {
      const cas = await tx.query<RevisionRow>(
        `update draw_revision set lifecycle = $3, published_at = now(), published_by = $4, lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
        [rev.id, cmd.expectedLockVersion, to, actor.userId],
      );
      if (cas.length === 0)
        return reject('REVISION_CONFLICT', [
          `expected lock_version ${cmd.expectedLockVersion}, current is different`,
        ]);
      const categories = await tx.query<{ category_id: string }>(
        `select distinct category_id from pool where revision_id = $1`,
        [rev.id],
      );
      for (const c of categories) {
        await tx.query(
          `insert into official_category_assignment (category_id, revision_id) values ($1,$2) on conflict (category_id) do update set revision_id = excluded.revision_id, published_at = now()`,
          [c.category_id, rev.id],
        );
      }
      // AUD-006: the replacement is now the official revision, so its AMENDED parent takes the
      // existing SUPERSEDE transition (no new state). Lineage, audit history and every artifact
      // that references the parent are untouched: only the lifecycle flag moves.
      if (rev.parent_revision_id) {
        const [parent] = await tx.query<RevisionRow>(`select * from draw_revision where id = $1 for update`, [
          rev.parent_revision_id,
        ]);
        if (parent && nextLifecycle(parent.lifecycle as never, 'SUPERSEDE') === 'SUPERSEDED') {
          const sup = await tx.query<RevisionRow>(
            `update draw_revision set lifecycle = 'SUPERSEDED', superseded_at = now(), lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
            [parent.id, parent.lock_version],
          );
          if (sup.length === 1) supersededParentId = parent.id;
        }
      }
    } else if (cmd.action === 'AMEND') {
      const cas = await tx.query<RevisionRow>(
        `update draw_revision set lifecycle = $3, lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
        [rev.id, cmd.expectedLockVersion, to],
      );
      if (cas.length === 0)
        return reject('REVISION_CONFLICT', [
          `expected lock_version ${cmd.expectedLockVersion}, current is different`,
        ]);
      const child = await tx.query<{ id: string }>(
        `insert into draw_revision (tournament_id, draw_run_id, revision_no, parent_revision_id, lifecycle, created_by) values ($1,$2,$3,$4,'DRAFT',$5) returning id`,
        [rev.tournament_id, rev.draw_run_id, rev.revision_no + 1, rev.id, actor.userId],
      );
      const childId = child[0]?.id ?? '';
      await copyRevisionContent(tx, rev.id, childId);
      resultingRevisionId = childId;
    } else {
      if (cmd.action === 'SUBMIT') {
        // Match codes are allocated while the revision is still DRAFT (allocateMatchCodes requires
        // it); the lifecycle flips to REVIEW only after allocation succeeds, so the CAS below runs
        // after allocation without racing another writer (this transaction already holds the row
        // implicitly via the upcoming UPDATE's WHERE clause, and expectedLockVersion still guards it).
        const [arena] = await tx.query<{ id: string }>(
          `select id from arena where tournament_id = $1 order by code limit 1`,
          [rev.tournament_id],
        );
        if (arena) {
          const { allocateMatchCodes } = await import('./match-code-repository.js');
          await allocateMatchCodes(tx, {
            tournamentId: rev.tournament_id,
            revisionId: rev.id,
            defaultArenaId: arena.id,
          });
        }
      }
      const cas = await tx.query<RevisionRow>(
        `update draw_revision set lifecycle = $3, lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
        [rev.id, cmd.expectedLockVersion, to],
      );
      if (cas.length === 0)
        return reject('REVISION_CONFLICT', [
          `expected lock_version ${cmd.expectedLockVersion}, current is different`,
        ]);
    }
    const verdict = GREEN;
    const id = await insertDrawCommand(tx, {
      tournamentId: rev.tournament_id,
      revisionId: rev.id,
      resultingRevisionId,
      cmd,
      actorId: actor.userId,
      outcome: 'APPLIED',
      rejectionCode: null,
      verdict,
    });
    await appendAuditEvent(tx, {
      chainKey: tournamentChainKey(rev.tournament_id),
      tournamentId: rev.tournament_id,
      actorKind: 'USER',
      actorId: actor.userId,
      action: `LIFECYCLE_${cmd.action}`,
      subjectType: 'DRAW_REVISION',
      subjectId: rev.id,
      before: { lifecycle: rev.lifecycle },
      after: { lifecycle: to, resultingRevisionId },
      reason: cmd.reason,
      complaintId: cmd.complaintId,
      commandId: id,
      correlationId: null,
    });
    if (supersededParentId) {
      await appendAuditEvent(tx, {
        chainKey: tournamentChainKey(rev.tournament_id),
        tournamentId: rev.tournament_id,
        actorKind: 'USER',
        actorId: actor.userId,
        action: 'LIFECYCLE_SUPERSEDE',
        subjectType: 'DRAW_REVISION',
        subjectId: supersededParentId,
        before: { lifecycle: 'AMENDED' },
        after: { lifecycle: 'SUPERSEDED', supersededBy: rev.id },
        reason: cmd.reason,
        complaintId: cmd.complaintId,
        commandId: id,
        correlationId: null,
      });
    }
    return {
      outcome: 'APPLIED',
      rejectionCode: null,
      verdict,
      resultingRevisionId,
      commandRowId: id,
      replayed: false,
    };
  }

  if (cmd.expectedLockVersion !== rev.lock_version)
    return reject('REVISION_CONFLICT', [
      `expected lock_version ${cmd.expectedLockVersion}, current is ${rev.lock_version}`,
    ]);

  // Acquire the row lock (and bump the version) BEFORE mutating content, so a concurrent command
  // against the same revision blocks here and then loses the CAS once this transaction commits.
  // draw_revision_guard requires every update to increment lock_version by exactly one — there is
  // no legal way to "undo" a bump, so a content rejection after a successful CAS throws instead
  // (ContentRejected), rolling back this whole transaction including the CAS; applyDrawCommand
  // then records the rejection in a fresh transaction that never touched draw_revision.
  const cas = await tx.query<RevisionRow>(
    `update draw_revision set lock_version = lock_version + 1 where id = $1 and lock_version = $2 returning *`,
    [rev.id, cmd.expectedLockVersion],
  );
  if (cas.length === 0)
    return reject('REVISION_CONFLICT', [
      `expected lock_version ${cmd.expectedLockVersion}, current is different`,
    ]);

  // AUD-005: remember the touched pools before the mutation so the change can be judged after it.
  const changed = await poolsChangedBy(tx, rev, cmd);
  const beforePools = changed ? await snapshotPools(tx, changed.poolIds) : null;

  const result = await applyContent(tx, rev, cmd);
  if ('rejected' in result) {
    throw new ContentRejected(result.rejected, result.hard);
  }

  let verdict: ConstraintVerdict = GREEN;
  if (changed && beforePools) {
    const evaluated = await evaluateChange(
      tx,
      rev,
      changed.categoryId,
      beforePools,
      await snapshotPools(tx, changed.poolIds),
    );
    if (evaluated) {
      verdict = evaluated.verdict;
      // Hard violations refuse the command; the transaction (including the CAS) rolls back.
      if (verdict.level === 'RED')
        throw new ContentRejected('HARD_CONSTRAINT_VIOLATED', evaluated.hard, verdict);
      // Soft degradation is allowed, but only with a stated reason (ADR-0004: YELLOW needs a reason).
      if (verdict.level === 'YELLOW' && (cmd.reason ?? '').trim() === '')
        throw new ContentRejected('REASON_REQUIRED', evaluated.soft, verdict);
    }
  }

  const { seed, budgetPerEntry } = await drawRunOf(tx, rev.id);
  for (const poolId of new Set(result.touchedPools)) {
    await rebuildPoolBracket(tx, { revisionId: rev.id, poolId, seed, budgetPerEntry });
  }

  const id = await insertDrawCommand(tx, {
    tournamentId: rev.tournament_id,
    revisionId: rev.id,
    resultingRevisionId: rev.id,
    cmd,
    actorId: actor.userId,
    outcome: 'APPLIED',
    rejectionCode: null,
    verdict,
  });
  await appendAuditEvent(tx, {
    chainKey: tournamentChainKey(rev.tournament_id),
    tournamentId: rev.tournament_id,
    actorKind: 'USER',
    actorId: actor.userId,
    action: cmd.type,
    subjectType: 'DRAW_REVISION',
    subjectId: rev.id,
    before: null,
    after: {
      touchedPools: result.touchedPools,
      verdict: verdict.level,
      violations: verdict.level === 'YELLOW' ? verdict.softViolations : [],
      impact: verdict.level === 'RED' ? null : (verdict.impact ?? null),
    },
    reason: cmd.reason,
    complaintId: cmd.complaintId,
    commandId: id,
    correlationId: null,
  });
  return {
    outcome: 'APPLIED',
    rejectionCode: null,
    verdict,
    resultingRevisionId: rev.id,
    commandRowId: id,
    replayed: false,
  };
}

/** Copies pool/pool_member/bracket/bracket_slot/match rows from one (frozen) revision into a fresh DRAFT one. */
async function copyRevisionContent(
  tx: SqlExecutor,
  fromRevisionId: string,
  toRevisionId: string,
): Promise<void> {
  const pools = await tx.query<{
    id: string;
    pool_uid: string;
    category_id: string;
    ordinal: number;
    is_walkover: boolean;
    metrics: unknown;
    explanation: unknown;
  }>(
    `select id, pool_uid, category_id, ordinal, is_walkover, metrics, explanation from pool where revision_id = $1`,
    [fromRevisionId],
  );
  for (const p of pools) {
    const [newPool] = await tx.query<{ id: string }>(
      `insert into pool (revision_id, pool_uid, category_id, ordinal, is_walkover, metrics, explanation) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`,
      [
        toRevisionId,
        p.pool_uid,
        p.category_id,
        p.ordinal,
        p.is_walkover,
        JSON.stringify(p.metrics),
        JSON.stringify(p.explanation),
      ],
    );
    const newPoolId = newPool?.id ?? '';
    const members = await tx.query<{ entry_id: string }>(
      `select entry_id from pool_member where pool_id = $1`,
      [p.id],
    );
    for (const m of members)
      await tx.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1,$2,$3)`, [
        newPoolId,
        toRevisionId,
        m.entry_id,
      ]);
    const [bracket] = await tx.query<{
      id: string;
      size: number;
      rounds: number;
      entries: number;
      byes: number;
    }>(`select id, size, rounds, entries, byes from bracket where pool_id = $1`, [p.id]);
    if (!bracket) continue;
    const [newBracket] = await tx.query<{ id: string }>(
      `insert into bracket (pool_id, revision_id, size, rounds, entries, byes) values ($1,$2,$3,$4,$5,$6) returning id`,
      [newPoolId, toRevisionId, bracket.size, bracket.rounds, bracket.entries, bracket.byes],
    );
    const newBracketId = newBracket?.id ?? '';
    const slots = await tx.query<{
      position: number;
      entry_id: string | null;
      seed_no: number | null;
      bye_reason: unknown;
    }>(`select position, entry_id, seed_no, bye_reason from bracket_slot where bracket_id = $1`, [
      bracket.id,
    ]);
    for (const s of slots)
      await tx.query(
        `insert into bracket_slot (bracket_id, position, entry_id, seed_no, bye_reason) values ($1,$2,$3,$4,$5::jsonb)`,
        [newBracketId, s.position, s.entry_id, s.seed_no, s.bye_reason ? JSON.stringify(s.bye_reason) : null],
      );
    const matches = await tx.query<{
      match_uid: string;
      round: number;
      position: number;
      feeder_a_slot: number | null;
      feeder_a_match_id: string | null;
      feeder_b_slot: number | null;
      feeder_b_match_id: string | null;
      status: string;
      public_code: string | null;
      arena_id: string | null;
      order_no: number | null;
    }>(
      `select match_uid, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, status, public_code, arena_id, order_no from match where bracket_id = $1 order by round, position`,
      [bracket.id],
    );
    // Round r's feeders always reference round r-1 at positions 2p-1 and 2p (fixed bracket shape,
    // see packages/draw-engine/src/bracket.ts); the new rows are keyed by (round, position) as
    // they are inserted, in round order, so both feeders already exist by the time they're needed.
    const idByRoundPosition = new Map<string, string>();
    for (const m of matches) {
      const feederAMatchId = m.feeder_a_match_id
        ? (idByRoundPosition.get(`${m.round - 1}:${2 * m.position - 1}`) ?? null)
        : null;
      const feederBMatchId = m.feeder_b_match_id
        ? (idByRoundPosition.get(`${m.round - 1}:${2 * m.position}`) ?? null)
        : null;
      const [row] = await tx.query<{ id: string }>(
        `insert into match (revision_id, match_uid, bracket_id, round, position, feeder_a_slot, feeder_a_match_id, feeder_b_slot, feeder_b_match_id, arena_id, order_no, public_code, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [
          toRevisionId,
          m.match_uid,
          newBracketId,
          m.round,
          m.position,
          m.feeder_a_slot,
          feederAMatchId,
          m.feeder_b_slot,
          feederBMatchId,
          m.arena_id,
          m.order_no,
          m.public_code,
          m.status,
        ],
      );
      idByRoundPosition.set(`${m.round}:${m.position}`, row?.id ?? '');
    }
  }
}

/**
 * Applies one domain command with full retry-on-audit-race semantics: the audit hash chain is
 * shared per tournament, so two commands against different revisions of the same tournament can
 * race for the chain head; the loser's whole transaction is retried (idempotency guarantees the
 * retry is safe — re-checking `draw_command` first is the very first thing `applyOnce` does).
 */
export async function applyDrawCommand(
  db: Db,
  cmd: DrawCommand,
  actor: CommandActor,
): Promise<CommandOutcome> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction((tx) => applyOnce(tx, cmd, actor));
    } catch (e: unknown) {
      if (e instanceof ContentRejected) {
        // The CAS succeeded and was then rolled back with everything else in that transaction;
        // record the rejection in a fresh one that touches nothing but draw_command.
        return await db.transaction((tx) => recordContentRejection(tx, cmd, actor, e));
      }
      if (isAuditChainRace(e) && attempt < maxAttempts) continue;
      throw e;
    }
  }
  throw new DomainError('AUDIT_CHAIN_RETRY_EXHAUSTED', { idempotencyKey: cmd.idempotencyKey });
}

async function recordContentRejection(
  tx: SqlExecutor,
  cmd: DrawCommand,
  actor: CommandActor,
  e: ContentRejected,
): Promise<CommandOutcome> {
  // Re-check idempotency: another attempt with the same key could have raced ahead in the retry.
  const existing = await tx.query<{
    id: string;
    outcome: 'APPLIED' | 'REJECTED';
    rejection_code: string | null;
    verdict: ConstraintVerdict;
    resulting_revision_id: string | null;
    payload: DrawCommand;
  }>(
    `select id, outcome, rejection_code, verdict, resulting_revision_id, payload from draw_command where tournament_id = (select tournament_id from draw_revision where id = $1) and idempotency_key = $2`,
    [cmd.revisionId, cmd.idempotencyKey],
  );
  if (existing[0]) {
    const ex = existing[0];
    if (fingerprint(ex.payload) !== fingerprint(cmd)) {
      return {
        outcome: 'REJECTED',
        rejectionCode: 'IDEMPOTENCY_CONFLICT',
        verdict: RED([`idempotency key ${cmd.idempotencyKey} was already used for a different command`]),
        resultingRevisionId: null,
        commandRowId: ex.id,
        replayed: false,
      };
    }
    return {
      outcome: ex.outcome,
      rejectionCode: (ex.rejection_code as CommandErrorCode) ?? null,
      verdict: ex.verdict,
      resultingRevisionId: ex.resulting_revision_id,
      commandRowId: ex.id,
      replayed: true,
    };
  }
  const rev = await loadRevision(tx, cmd.revisionId);
  if (!rev) throw new DomainError('REVISION_NOT_FOUND', { revisionId: cmd.revisionId });
  const verdict = e.verdict ?? RED(e.hard);
  const id = await insertDrawCommand(tx, {
    tournamentId: rev.tournament_id,
    revisionId: rev.id,
    resultingRevisionId: null,
    cmd,
    actorId: actor.userId,
    outcome: 'REJECTED',
    rejectionCode: e.code,
    verdict,
  });
  return {
    outcome: 'REJECTED',
    rejectionCode: e.code,
    verdict,
    resultingRevisionId: null,
    commandRowId: id,
    replayed: false,
  };
}

export const sortReasons = (reasons: readonly string[]): string[] => sortedBy([...reasons], compareStrings);
export { isContentFrozen };
