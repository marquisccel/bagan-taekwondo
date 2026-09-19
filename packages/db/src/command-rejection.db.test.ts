import { randomUUID } from 'node:crypto';

import type { DrawCommand } from '@bagantkd/domain';
import type * as DrawEngine from '@bagantkd/draw-engine';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { applyDrawCommand, type CommandActor } from './command-repository.js';
import { kyorugiSemiCsv, provisionalRuleSet, seedDrawnRevision } from './testing/seed-revision.js';
import { newArena, newTournament } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * AUD-007: a bracket-invariant failure while rebuilding a pool after MOVE/SWAP is an expected,
 * stable rejection (no partial mutation, rolled back, machine-readable code); anything else that
 * goes wrong stays an opaque programming error and is NOT turned into a business outcome.
 */
const mode = vi.hoisted((): { value: 'off' | 'violation' | 'crash' } => ({ value: 'off' }));
vi.mock('@bagantkd/draw-engine', async (importOriginal) => {
  const real = await importOriginal<typeof DrawEngine>();
  return {
    ...real,
    checkBracket: (...args: Parameters<typeof real.checkBracket>) => {
      if (mode.value === 'violation') return [{ code: 'FORCED_INVARIANT', detail: 'forced for the test' }];
      if (mode.value === 'crash') throw new Error('boom: unexpected defect');
      return real.checkBracket(...args);
    },
  };
});

const athlete = (name: string, heightCm: number, contingent: string) => ({
  name,
  contingent,
  heightCm,
  weightKg: 44,
  belt: 'GEUP 9 - KUNING',
});

for (const backend of testBackends()) {
  describe(`clean command rejection (AUD-007) — ${backend.name}`, () => {
    let db: TestDb;
    let tournament: string;
    let officer: CommandActor;
    let revisionId: string;
    let entryId: string;
    let poolUid: string;

    beforeAll(async () => {
      mode.value = 'off';
      db = await backend.open();
      const t = await newTournament(db);
      tournament = t.tournament;
      await newArena(db, tournament);
      officer = { userId: t.officer, role: 'DRAWING_OFFICER' };
      ({ revisionId } = await seedDrawnRevision(
        db,
        { tournamentId: tournament, actorId: t.officer },
        provisionalRuleSet,
        kyorugiSemiCsv([
          athlete('Satu', 150, 'Kota A'),
          athlete('Dua', 151, 'Kota B'),
          athlete('Tiga', 152, 'Kota C'),
        ]),
      ));
      const [row] = await db.query<{ entry_id: string; pool_uid: string }>(
        `select pm.entry_id, p.pool_uid from pool_member pm join pool p on p.id = pm.pool_id where p.revision_id = $1 limit 1`,
        [revisionId],
      );
      entryId = row?.entry_id ?? '';
      poolUid = row?.pool_uid ?? '';
    }, 60_000);

    const lockVersion = async () =>
      (
        await db.query<{ lock_version: number }>(`select lock_version from draw_revision where id = $1`, [
          revisionId,
        ])
      )[0]?.lock_version ?? -1;
    const snapshot = async () =>
      JSON.stringify(
        await db.query(
          `select m.match_uid, m.round, m.position, m.status, m.feeder_a_slot, m.feeder_b_slot
           from match m where m.revision_id = $1 order by m.match_uid`,
          [revisionId],
        ),
      );
    // A same-pool move changes nothing but still rebuilds that pool's bracket.
    const cmd = async (): Promise<DrawCommand> => ({
      type: 'MOVE_ENTRY',
      revisionId,
      entryId,
      toPoolUid: poolUid,
      toSlot: null,
      expectedLockVersion: await lockVersion(),
      idempotencyKey: randomUUID(),
      reason: null,
      complaintId: null,
    });

    it('an invariant violation is a stable REJECTED outcome with a code, and nothing changes', async () => {
      const v = await lockVersion();
      const matches = await snapshot();
      mode.value = 'violation';
      try {
        const out = await applyDrawCommand(db, await cmd(), officer);
        expect(out).toMatchObject({
          outcome: 'REJECTED',
          rejectionCode: 'BRACKET_INVARIANT_VIOLATED',
          resultingRevisionId: null,
        });
        expect(out.verdict).toEqual({ level: 'RED', hardViolations: ['FORCED_INVARIANT'] });
        const [logged] = await db.query<{ outcome: string; rejection_code: string }>(
          `select outcome, rejection_code from draw_command where id = $1`,
          [out.commandRowId],
        );
        expect(logged).toEqual({ outcome: 'REJECTED', rejection_code: 'BRACKET_INVARIANT_VIOLATED' });
      } finally {
        mode.value = 'off';
      }
      expect(await lockVersion()).toBe(v); // the CAS bump was rolled back with the rest
      expect(await snapshot()).toBe(matches); // no partial bracket rebuild
    }, 60_000);

    it('an unexpected defect is NOT a business outcome: it propagates untouched and rolls back', async () => {
      const v = await lockVersion();
      const matches = await snapshot();
      mode.value = 'crash';
      try {
        await expect(applyDrawCommand(db, await cmd(), officer)).rejects.toThrow('boom: unexpected defect');
      } finally {
        mode.value = 'off';
      }
      expect(await lockVersion()).toBe(v);
      expect(await snapshot()).toBe(matches);
    }, 60_000);

    it('the same command succeeds once the invariant holds again (no poisoned state)', async () => {
      const out = await applyDrawCommand(db, await cmd(), officer);
      expect(out).toMatchObject({ outcome: 'APPLIED' });
    }, 60_000);
  });
}
