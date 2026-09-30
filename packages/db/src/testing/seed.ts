import { randomUUID } from 'node:crypto';

import { sha256Hex } from '@bagantkd/shared';

import type { Db } from '../db.js';

const fp = (s: string) => `sha256:${sha256Hex(s)}`;

/**
 * A COMMITTED empty import batch and its (empty) intake snapshot: every draw run is bound to one.
 * Walks the batch lifecycle the only legal way: UPLOADED → PARSED → VALIDATED → COMMITTED.
 */
export async function newSnapshot(
  db: Db,
  tournament: string,
  ruleSet: string,
  actor: string,
): Promise<string> {
  const sha = sha256Hex(randomUUID());
  const [batch] = await db.query<{ id: string }>(
    `insert into import_batch (tournament_id, rule_set_id, source_filename, source_sha256, row_count, column_mapping, adapter, created_by)
     values ($1, $2, 'seed.csv', $3, 0, '{}', 'test', $4) returning id`,
    [tournament, ruleSet, sha, actor],
  );
  const id = batch?.id ?? '';
  for (const status of ['PARSED', 'VALIDATED']) {
    await db.query(`update import_batch set status = $2 where id = $1`, [id, status]);
  }
  await db.query(
    `update import_batch set status = 'COMMITTED', committed_at = now(), content_fingerprint = $2 where id = $1`,
    [id, fp('[]')],
  );
  const content = {
    schemaVersion: 1,
    adapter: 'test',
    ruleSetFingerprint: fp('rules'),
    source: { fingerprint: `sha256:${sha}` },
    entries: [],
    excluded: [],
  };
  const [snap] = await db.query<{ id: string }>(
    `insert into intake_snapshot (tournament_id, batch_id, rule_set_id, adapter, schema_version, rule_set_fingerprint, fingerprint, entry_count, content, created_by)
     values ($1, $2, $3, 'test', 1, $4, $5, 0, $6::jsonb, $7) returning id`,
    [tournament, id, ruleSet, fp('rules'), fp(JSON.stringify(content)), JSON.stringify(content), actor],
  );
  return snap?.id ?? '';
}

/** An isolated tournament with a Technical Delegate, a Drawing Officer, a Viewer and a rule-set header row. */
export async function newTournament(db: Db): Promise<{
  tournament: string;
  tournamentCode: string;
  ruleSet: string;
  td: string;
  officer: string;
  viewer: string;
}> {
  const tag = randomUUID().slice(0, 8);
  const tournamentCode = `T_${tag}`;
  const user = async (role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into app_user (email, display_name, password_hash) values ($1, $2, 'x') returning id`,
        [`${role}-${tag}@t`, role],
      )
    )[0]?.id ?? '';
  const td = await user('td');
  const officer = await user('do');
  const viewer = await user('viewer');
  const tournament =
    (
      await db.query<{ id: string }>(
        `insert into tournament (code, name, event_start, event_end, timezone) values ($1, 'T', '2026-08-27', '2026-08-30', 'Asia/Jakarta') returning id`,
        [tournamentCode],
      )
    )[0]?.id ?? '';
  await db.query(
    `insert into tournament_member (tournament_id, user_id, role) values ($1, $2, 'TECHNICAL_DELEGATE'), ($1, $3, 'DRAWING_OFFICER'), ($1, $4, 'VIEWER')`,
    [tournament, td, officer, viewer],
  );
  const ruleSet =
    (
      await db.query<{ id: string }>(
        `insert into rule_set (tournament_id, code, version, name, age_policy, age_reference_year, age_provenance, plausibility, source_vocabulary)
         values ($1, 'RS', 1, 'rs', 'BIRTH_YEAR', 2026, '{"source":"EVIDENCE_2026"}', '{}', '{}') returning id`,
        [tournament],
      )
    )[0]?.id ?? '';
  return { tournament, tournamentCode, ruleSet, td, officer, viewer };
}

/** Fixed, test-only NIK keys (never used outside tests). */
export const TEST_NIK_KEYS = {
  encryptionKey: new Uint8Array(32).fill(1),
  blindIndexKey: new Uint8Array(32).fill(2),
};

/** A default arena ("A") for the tournament, for tests that allocate match codes or move pools. */
export async function newArena(db: Db, tournament: string, code = 'A'): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into arena (tournament_id, code, name) values ($1, $2, $2) returning id`,
    [tournament, code],
  );
  return row?.id ?? '';
}
