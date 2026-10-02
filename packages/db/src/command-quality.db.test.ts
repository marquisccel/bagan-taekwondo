import { randomUUID } from 'node:crypto';

import type { ConstraintVerdict, DrawCommand } from '@bagantkd/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyDrawCommand, type CommandActor } from './command-repository.js';
import {
  kyorugiSemiCsv,
  provisionalRuleSet,
  seedDrawnRevision,
  type SyntheticAthlete,
} from './testing/seed-revision.js';
import { newArena, newTournament } from './testing/seed.js';
import { testBackends, type TestDb } from './testing/test-db.js';

/**
 * AUD-005: MoveEntry / SwapEntries return the engine's canonical quality verdict (GREEN / YELLOW /
 * RED with machine-readable codes), refuse hard violations without touching anything, require a
 * reason for soft degradation, and persist the verdict in the command log and the audit trail.
 */
const A9 = 'GEUP 9 - KUNING';
const A2 = 'GEUP 2 - MERAH STRIP 1';
const athlete = (
  name: string,
  contingent: string,
  o: Partial<Pick<SyntheticAthlete, 'heightCm' | 'weightKg' | 'belt'>> = {},
): SyntheticAthlete => ({ name, contingent, heightCm: 152, weightKg: 44, belt: A9, ...o });

interface PoolView {
  poolUid: string;
  ordinal: number;
  members: { entryId: string; name: string; contingent: string }[];
}

for (const backend of testBackends()) {
  describe(`command quality verdict (AUD-005) — ${backend.name}`, () => {
    let db: TestDb;
    beforeAll(async () => {
      db = await backend.open();
    }, 60_000);

    const key = () => randomUUID();

    async function scenario(athletes: SyntheticAthlete[]) {
      const t = await newTournament(db);
      await newArena(db, t.tournament);
      const { revisionId } = await seedDrawnRevision(
        db,
        { tournamentId: t.tournament, actorId: t.officer },
        provisionalRuleSet,
        kyorugiSemiCsv(athletes),
      );
      const officer: CommandActor = { userId: t.officer, role: 'DRAWING_OFFICER' };
      const pools = async (): Promise<PoolView[]> => {
        const rows = await db.query<{
          pool_uid: string;
          ordinal: number;
          entry_id: string;
          full_name: string;
          contingent: string;
        }>(
          `select p.pool_uid, p.ordinal, e.id as entry_id, a.full_name, con.name as contingent
           from pool p
           join pool_member pm on pm.pool_id = p.id
           join entry e on e.id = pm.entry_id
           join contingent con on con.id = e.contingent_id
           join entry_member em on em.entry_id = e.id and em.position = 1
           join athlete a on a.id = em.athlete_id
           where p.revision_id = $1 order by p.ordinal, a.full_name`,
          [revisionId],
        );
        const out = new Map<string, PoolView>();
        for (const r of rows) {
          const p = out.get(r.pool_uid) ?? { poolUid: r.pool_uid, ordinal: r.ordinal, members: [] };
          p.members.push({ entryId: r.entry_id, name: r.full_name, contingent: r.contingent });
          out.set(r.pool_uid, p);
        }
        return [...out.values()].sort((x, y) => x.ordinal - y.ordinal);
      };
      const lockVersion = async () =>
        (
          await db.query<{ lock_version: number }>(`select lock_version from draw_revision where id = $1`, [
            revisionId,
          ])
        )[0]?.lock_version ?? -1;
      const move = async (
        entryId: string,
        toPoolUid: string,
        reason: string | null = null,
        expected?: number,
      ) =>
        applyDrawCommand(
          db,
          {
            type: 'MOVE_ENTRY',
            revisionId,
            entryId,
            toPoolUid,
            toSlot: null,
            expectedLockVersion: expected ?? (await lockVersion()),
            idempotencyKey: key(),
            reason,
            complaintId: null,
          } satisfies DrawCommand,
          officer,
        );
      const swap = async (entryA: string, entryB: string, reason: string | null = null) =>
        applyDrawCommand(
          db,
          {
            type: 'SWAP_ENTRIES',
            revisionId,
            entryA,
            entryB,
            expectedLockVersion: await lockVersion(),
            idempotencyKey: key(),
            reason,
            complaintId: null,
          } satisfies DrawCommand,
          officer,
        );
      return { t, revisionId, pools, lockVersion, move, swap };
    }

    const softOf = (v: ConstraintVerdict) => (v.level === 'YELLOW' ? v.softViolations : []);

    it('HEIGHT degradation: YELLOW needs a reason; without one nothing changes, with one it applies and is audited', async () => {
      const s = await scenario([
        ...[150, 151, 152, 153].map((h, i) =>
          athlete(`Pendek ${i + 1}`, `Kota ${'ABAC'[i]}`, { heightCm: h }),
        ),
        ...[170, 171, 172].map((h, i) => athlete(`Tinggi ${i + 1}`, `Kota ${'ABC'[i]}`, { heightCm: h })),
      ]);
      const [short, tall] = await s.pools();
      expect(short?.members).toHaveLength(4);
      expect(tall?.members).toHaveLength(3);
      const mover = short?.members[0]?.entryId as string;
      const v0 = await s.lockVersion();

      const refused = await s.move(mover, tall?.poolUid as string);
      expect(refused).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REASON_REQUIRED' });
      expect(refused.verdict.level).toBe('YELLOW');
      expect(softOf(refused.verdict)).toContain('HEIGHT_TOLERANCE_WORSENED');
      // no partial mutation, no version bump, the attempt is logged with its verdict
      expect(await s.lockVersion()).toBe(v0);
      expect((await s.pools()).map((p) => p.members.length)).toEqual([4, 3]);
      const [logged] = await db.query<{
        outcome: string;
        rejection_code: string;
        verdict: ConstraintVerdict;
      }>(`select outcome, rejection_code, verdict from draw_command where id = $1`, [refused.commandRowId]);
      expect(logged).toMatchObject({ outcome: 'REJECTED', rejection_code: 'REASON_REQUIRED' });
      expect(softOf(logged?.verdict as ConstraintVerdict)).toContain('HEIGHT_TOLERANCE_WORSENED');

      const applied = await s.move(mover, tall?.poolUid as string, 'Keluhan kontingen: pindah demi jadwal');
      expect(applied).toMatchObject({ outcome: 'APPLIED', rejectionCode: null });
      expect(applied.verdict.level).toBe('YELLOW');
      expect(softOf(applied.verdict)).toContain('HEIGHT_TOLERANCE_WORSENED');
      expect(applied.verdict.impact?.change).toBe('WORSE');
      expect(applied.verdict.impact?.after.excess['HEIGHT']).toBeGreaterThan(
        applied.verdict.impact?.before.excess['HEIGHT'] ?? 0,
      );
      expect(await s.lockVersion()).toBe(v0 + 1);
      expect((await s.pools()).map((p) => p.members.length)).toEqual([3, 4]);

      // persisted audit reason: who/why/what impact, machine-readable
      const [audit] = await db.query<{
        action: string;
        reason: string | null;
        after: { verdict: string; violations: string[]; impact: { change: string } };
      }>(
        `select action, reason, after from audit_event where tournament_id = $1 and action = 'MOVE_ENTRY' order by seq desc limit 1`,
        [s.t.tournament],
      );
      expect(audit?.reason).toBe('Keluhan kontingen: pindah demi jadwal');
      expect(audit?.after.verdict).toBe('YELLOW');
      expect(audit?.after.violations).toContain('HEIGHT_TOLERANCE_WORSENED');
      expect(audit?.after.impact.change).toBe('WORSE');
      const [cmd] = await db.query<{ verdict: ConstraintVerdict }>(
        `select verdict from draw_command where id = $1`,
        [applied.commandRowId],
      );
      expect(cmd?.verdict.level).toBe('YELLOW');

      // moving it back is a plain improvement: GREEN, no reason needed
      const back = await s.move(mover, short?.poolUid as string);
      expect(back).toMatchObject({ outcome: 'APPLIED' });
      expect(back.verdict.level).toBe('GREEN');
      expect(back.verdict.impact?.change).toBe('IMPROVED');
      expect((await s.pools()).map((p) => p.members.length)).toEqual([4, 3]);
    }, 120_000);

    it('HARD violation (pool over its maximum) is RED: refused, rolled back, logged, no reason can override it', async () => {
      const s = await scenario([
        ...[150, 151, 152, 153].map((h, i) =>
          athlete(`Pendek ${i + 1}`, `Kota ${'ABAC'[i]}`, { heightCm: h }),
        ),
        ...[170, 171, 172].map((h, i) => athlete(`Tinggi ${i + 1}`, `Kota ${'ABC'[i]}`, { heightCm: h })),
      ]);
      const [short, tall] = await s.pools();
      const first = await s.move(short?.members[0]?.entryId as string, tall?.poolUid as string, 'alasan 1');
      expect(first.outcome).toBe('APPLIED'); // tall pool now has 4 = the maximum
      const v = await s.lockVersion();
      const before = await s.pools();

      const red = await s.move(
        short?.members[1]?.entryId as string,
        tall?.poolUid as string,
        'Saya tetap ingin memindahkan',
      );
      expect(red).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'HARD_CONSTRAINT_VIOLATED' });
      expect(red.verdict).toMatchObject({ level: 'RED', hardViolations: ['POOL_SIZE_EXCEEDED'] });
      expect(await s.lockVersion()).toBe(v);
      expect(await s.pools()).toEqual(before);
      const [logged] = await db.query<{
        outcome: string;
        rejection_code: string;
        verdict: ConstraintVerdict;
      }>(`select outcome, rejection_code, verdict from draw_command where id = $1`, [red.commandRowId]);
      expect(logged).toMatchObject({ outcome: 'REJECTED', rejection_code: 'HARD_CONSTRAINT_VIOLATED' });
      expect(logged?.verdict.level).toBe('RED');
      // the rejected attempt left no audit event for a content change
      const [n] = await db.query<{ n: number }>(
        `select count(*)::int as n from audit_event where tournament_id = $1 and action = 'MOVE_ENTRY'`,
        [s.t.tournament],
      );
      expect(n?.n).toBe(1);
    }, 120_000);

    it('WEIGHT degradation on a swap is YELLOW WEIGHT_TOLERANCE_WORSENED', async () => {
      const s = await scenario([
        ...[40, 41, 42, 43].map((w, i) => athlete(`Ringan ${i + 1}`, `Kota ${'ABAC'[i]}`, { weightKg: w })),
        ...[62, 63, 64].map((w, i) => athlete(`Berat ${i + 1}`, `Kota ${'ABC'[i]}`, { weightKg: w })),
      ]);
      const [light, heavy] = await s.pools();
      const out = await s.swap(light?.members[0]?.entryId as string, heavy?.members[0]?.entryId as string);
      expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REASON_REQUIRED' });
      expect(softOf(out.verdict)).toContain('WEIGHT_TOLERANCE_WORSENED');
      expect(softOf(out.verdict)).not.toContain('HEIGHT_TOLERANCE_WORSENED');
      const ok = await s.swap(
        light?.members[0]?.entryId as string,
        heavy?.members[0]?.entryId as string,
        'Pertukaran atas keputusan panitia',
      );
      expect(ok).toMatchObject({ outcome: 'APPLIED' });
      expect(softOf(ok.verdict)).toContain('WEIGHT_TOLERANCE_WORSENED');
    }, 120_000);

    it('BELT degradation on a swap is YELLOW BELT_TOLERANCE_WORSENED', async () => {
      const s = await scenario([
        ...[0, 1, 2, 3].map((i) => athlete(`Kuning ${i + 1}`, `Kota ${'ABAC'[i]}`, { belt: A9 })),
        ...[0, 1, 2].map((i) => athlete(`Merah ${i + 1}`, `Kota ${'ABC'[i]}`, { belt: A2 })),
      ]);
      const [low, high] = await s.pools();
      const out = await s.swap(low?.members[0]?.entryId as string, high?.members[0]?.entryId as string);
      expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REASON_REQUIRED' });
      expect(softOf(out.verdict)).toContain('BELT_TOLERANCE_WORSENED');
    }, 120_000);

    it('CONTINGENT degradation: concentrating a contingent is YELLOW, and the engine draw itself spreads outsiders (AUD-004)', async () => {
      const s = await scenario([
        ...Array.from({ length: 6 }, (_, i) => athlete(`Dominan ${i + 1}`, 'Kota A')),
        athlete('Luar B', 'Kota B'),
        athlete('Luar C', 'Kota C'),
      ]);
      const pools = await s.pools();
      const shape = pools.map((p) =>
        p.members
          .map((m) => m.contingent.slice(-1))
          .sort()
          .join(''),
      );
      expect(shape.sort()).toEqual(['AAAB', 'AAAC']); // AUD-004: every pool has an outsider
      const withC = pools.find((p) => p.members.some((m) => m.contingent === 'Kota C'));
      const withB = pools.find((p) => p.members.some((m) => m.contingent === 'Kota B'));
      const c = withC?.members.find((m) => m.contingent === 'Kota C');
      const a = withB?.members.find((m) => m.contingent === 'Kota A');
      // swap C (pool AAAC) with an A from the AAAB pool -> AAAA + AABC: concentration worsens
      const out = await s.swap(c?.entryId as string, a?.entryId as string);
      expect(out).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'REASON_REQUIRED' });
      expect(softOf(out.verdict)).toEqual(['CONTINGENT_CONCENTRATION_WORSENED']);
    }, 120_000);

    it('a move into the same pool is a no-op: GREEN without impact', async () => {
      const s = await scenario([
        ...[150, 151, 152, 153].map((h, i) =>
          athlete(`Pendek ${i + 1}`, `Kota ${'ABAC'[i]}`, { heightCm: h }),
        ),
        ...[170, 171, 172].map((h, i) => athlete(`Tinggi ${i + 1}`, `Kota ${'ABC'[i]}`, { heightCm: h })),
      ]);
      const [short] = await s.pools();
      const out = await s.move(short?.members[0]?.entryId as string, short?.poolUid as string);
      expect(out).toMatchObject({ outcome: 'APPLIED' });
      expect(out.verdict).toEqual({ level: 'GREEN' });
    }, 120_000);

    // Regression (High severity bug report): dragging one athlete onto another's bracket slot, within
    // the SAME pool, used to only ever visibly move anything on the very first drag -- every swap
    // after that silently did nothing. Root cause: a same-pool SWAP_ENTRIES left pool_member
    // untouched and rebuilt the bracket from scratch, which is a pure function of the (unchanged)
    // member set and seed, so it deterministically reproduced the exact same layout every time.
    it('swaps two entries bracket slots for a same-pool swap, and keeps swapping correctly on repeat (regression: used to only work once)', async () => {
      const s = await scenario([
        ...[150, 151, 152, 153].map((h, i) =>
          athlete(`Pendek ${i + 1}`, `Kota ${'ABAC'[i]}`, { heightCm: h }),
        ),
      ]);
      const [pool] = await s.pools();
      const [m1, m2] = pool?.members ?? [];
      if (!m1 || !m2) throw new Error('expected at least 2 members in one pool');

      const slotEntryIds = async (): Promise<{ position: number; entry_id: string | null }[]> =>
        db.query<{ position: number; entry_id: string | null }>(
          `select bs.position, bs.entry_id
           from bracket_slot bs
           join bracket b on b.id = bs.bracket_id
           join pool p on p.id = b.pool_id
           where p.pool_uid = $1 and p.revision_id = $2
           order by bs.position`,
          [pool?.poolUid, s.revisionId],
        );

      const before = await slotEntryIds();
      const slotA = before.find((r) => r.entry_id === m1.entryId);
      const slotB = before.find((r) => r.entry_id === m2.entryId);
      if (!slotA || !slotB) throw new Error('expected both entries to already have a bracket slot');

      const swap1 = await s.swap(m1.entryId, m2.entryId);
      expect(swap1).toMatchObject({ outcome: 'APPLIED' });
      const afterFirst = await slotEntryIds();
      expect(afterFirst.find((r) => r.position === slotA.position)?.entry_id).toBe(m2.entryId);
      expect(afterFirst.find((r) => r.position === slotB.position)?.entry_id).toBe(m1.entryId);

      // The second drag-and-drop in the bug report -- the one that used to silently no-op. Swapping
      // the same pair back must move them back, not leave the first swap's layout in place.
      const swap2 = await s.swap(m1.entryId, m2.entryId);
      expect(swap2).toMatchObject({ outcome: 'APPLIED' });
      const afterSecond = await slotEntryIds();
      expect(afterSecond.find((r) => r.position === slotA.position)?.entry_id).toBe(m1.entryId);
      expect(afterSecond.find((r) => r.position === slotB.position)?.entry_id).toBe(m2.entryId);
    }, 120_000);

    it('swaps two entries across different pools of the same category, moving pool membership and rebuilding both brackets', async () => {
      const s = await scenario([
        ...[150, 151, 152, 153, 154, 155, 156, 157].map((h, i) =>
          athlete(`Peserta ${i + 1}`, `Kota ${'ABACADAB'[i]}`, { heightCm: h }),
        ),
      ]);
      const pools = await s.pools();
      expect(pools.length).toBeGreaterThanOrEqual(2);
      const [poolA, poolB] = pools;
      const entryA = poolA?.members[0];
      const entryB = poolB?.members[0];
      if (!poolA || !poolB || !entryA || !entryB)
        throw new Error('expected 2 pools with at least 1 member each');

      const membersOf = async (poolUid: string): Promise<string[]> =>
        (await s.pools()).find((p) => p.poolUid === poolUid)?.members.map((m) => m.entryId) ?? [];

      // Swapping across pools changes each pool's height/weight/belt spread, which can soft-degrade
      // quality (YELLOW) same as a same-pool swap can -- a reason is required to proceed, exactly
      // like the other quality-gated commands in this file.
      const result = await s.swap(entryA.entryId, entryB.entryId, 'cross-pool rebalance for testing');
      expect(result).toMatchObject({ outcome: 'APPLIED' });

      const afterA = await membersOf(poolA.poolUid);
      const afterB = await membersOf(poolB.poolUid);
      expect(afterA).not.toContain(entryA.entryId);
      expect(afterA).toContain(entryB.entryId);
      expect(afterB).not.toContain(entryB.entryId);
      expect(afterB).toContain(entryA.entryId);

      // Both pools' brackets must have been rebuilt with the new membership -- the swapped entry
      // actually has a bracket slot in its new pool, not just a dangling pool_member row.
      const slotEntryIdsOf = async (poolUid: string): Promise<(string | null)[]> =>
        db
          .query<{ entry_id: string | null }>(
            `select bs.entry_id from bracket_slot bs join bracket b on b.id = bs.bracket_id
             join pool p on p.id = b.pool_id where p.pool_uid = $1 and p.revision_id = $2`,
            [poolUid, s.revisionId],
          )
          .then((rows) => rows.map((r) => r.entry_id));
      expect(await slotEntryIdsOf(poolA.poolUid)).toContain(entryB.entryId);
      expect(await slotEntryIdsOf(poolB.poolUid)).toContain(entryA.entryId);

      // Swapping them back must restore the original membership, not no-op or duplicate.
      const back = await s.swap(entryB.entryId, entryA.entryId, 'cross-pool rebalance for testing');
      expect(back).toMatchObject({ outcome: 'APPLIED' });
      expect(await membersOf(poolA.poolUid)).toEqual(expect.arrayContaining([entryA.entryId]));
      expect(await membersOf(poolB.poolUid)).toEqual(expect.arrayContaining([entryB.entryId]));
    }, 120_000);
  });
}
