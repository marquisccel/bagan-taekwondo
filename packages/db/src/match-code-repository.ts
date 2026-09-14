import { DomainError } from '@bagantkd/shared';

import type { Db } from './db.js';
import type { SqlExecutor } from './intake-repository.js';

/**
 * Public match codes (ADR-0005). Internal identity (`match.id`) and logical identity
 * (`match.match_uid`, deterministic from category/pool-ordinal/round/position — stable across a
 * pool regeneration that keeps the same shape) are separate from the printed `public_code`.
 *
 * Allocation happens once a revision is submitted for review (still DRAFT at that point): matches
 * are visited in schedule order (arena, then category, pool ordinal, round, position); a match
 * whose `match_uid` already has a live registry entry keeps that code; a new logical match gets
 * the next unused number for its arena. A match present in the parent revision but absent here
 * has its code retired (once; never reused, never deleted).
 */
const one = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new DomainError('MATCH_CODE_ROW_MISSING', {}, 'expected row missing');
  return row;
};

interface MatchRow {
  readonly id: string;
  readonly match_uid: string;
  readonly arena_id: string | null;
}

export async function allocateMatchCodes(
  tx: SqlExecutor,
  args: { tournamentId: string; revisionId: string; defaultArenaId: string },
): Promise<{ allocated: number; reused: number; retired: number }> {
  const [revision] = await tx.query<{
    lifecycle: string;
    parent_revision_id: string | null;
    draw_run_id: string;
  }>(`select lifecycle, parent_revision_id, draw_run_id from draw_revision where id = $1`, [args.revisionId]);
  if (!revision) throw new DomainError('REVISION_NOT_FOUND', { revisionId: args.revisionId });
  if (revision.lifecycle !== 'DRAFT')
    throw new DomainError('REVISION_CONTENT_FROZEN', {
      revisionId: args.revisionId,
      lifecycle: revision.lifecycle,
    });

  const matches = await tx.query<
    MatchRow & { category_code: string; pool_ordinal: number; round: number; position: number }
  >(
    `select m.id, m.match_uid, coalesce(m.arena_id, $2) as arena_id, c.category_key as category_code, p.ordinal as pool_ordinal, m.round, m.position
     from match m join bracket b on b.id = m.bracket_id join pool p on p.id = b.pool_id join category c on c.id = p.category_id
     where m.revision_id = $1
     order by c.category_key, p.ordinal, m.round, m.position`,
    [args.revisionId, args.defaultArenaId],
  );

  let allocated = 0;
  let reused = 0;
  const nextSeqByArena = new Map<string, number>();
  for (const m of matches) {
    const arenaId = m.arena_id ?? args.defaultArenaId;
    const [existing] = await tx.query<{ public_code: string; retired_revision_id: string | null }>(
      `select public_code, retired_revision_id from match_code_registry where tournament_id = $1 and match_uid = $2`,
      [args.tournamentId, m.match_uid],
    );
    let code = existing && existing.retired_revision_id === null ? existing.public_code : null;
    if (!code) {
      if (!nextSeqByArena.has(arenaId)) {
        const [arena] = await tx.query<{ code: string }>(`select code from arena where id = $1`, [arenaId]);
        if (!arena) throw new DomainError('ARENA_NOT_FOUND', { arenaId });
        const used = await tx.query<{ n: number }>(
          `select count(*)::int as n from match_code_registry where tournament_id = $1 and arena_id = $2`,
          [args.tournamentId, arenaId],
        );
        nextSeqByArena.set(arenaId, (used[0]?.n ?? 0) + 1);
      }
      const seq = nextSeqByArena.get(arenaId) as number;
      nextSeqByArena.set(arenaId, seq + 1);
      const [arena] = await tx.query<{ code: string }>(`select code from arena where id = $1`, [arenaId]);
      code = `${arena?.code ?? 'A'}${String(seq).padStart(3, '0')}`;
      await tx.query(
        `insert into match_code_registry (tournament_id, public_code, arena_id, match_uid, first_revision_id) values ($1,$2,$3,$4,$5)`,
        [args.tournamentId, code, arenaId, m.match_uid, args.revisionId],
      );
      allocated += 1;
    } else {
      reused += 1;
    }
    await tx.query(`update match set public_code = $2, arena_id = coalesce(arena_id, $3) where id = $1`, [
      m.id,
      code,
      arenaId,
    ]);
  }

  let retired = 0;
  if (revision.parent_revision_id) {
    const parentUids = await tx.query<{ match_uid: string }>(
      `select match_uid from match where revision_id = $1`,
      [revision.parent_revision_id],
    );
    const currentUids = new Set(matches.map((m) => m.match_uid));
    const gone = parentUids.map((r) => r.match_uid).filter((uid) => !currentUids.has(uid));
    for (const uid of gone) {
      const result = await tx.query<{ public_code: string }>(
        `update match_code_registry set retired_revision_id = $1 where tournament_id = $2 and match_uid = $3 and retired_revision_id is null returning public_code`,
        [args.revisionId, args.tournamentId, uid],
      );
      if (result.length > 0) retired += 1;
    }
  }
  return { allocated, reused, retired };
}

/** Ensures at least one arena exists for the tournament (a demo/test default); returns its id. */
export async function ensureDefaultArena(db: Db, tournamentId: string): Promise<string> {
  const [existing] = await db.query<{ id: string }>(
    `select id from arena where tournament_id = $1 order by code limit 1`,
    [tournamentId],
  );
  if (existing) return existing.id;
  return one(
    await db.query<{ id: string }>(
      `insert into arena (tournament_id, code, name) values ($1, 'A', 'Arena A') returning id`,
      [tournamentId],
    ),
  ).id;
}
