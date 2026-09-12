import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canTransitionImportBatch, IMPORT_BATCH_STATUSES, type ImportBatchStatus } from '@bagantkd/domain';
import { diffIntake, runIntake, type IntakeResult } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import { canonicalJson, sha256Hex } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadSnapshot,
  persistIntake,
  verifyBatchContent,
  type PersistIntakeOutcome,
} from './intake-repository.js';
import { decryptNik, nikBlindIndex } from './nik-crypto.js';
import { newTournament, TEST_NIK_KEYS } from './testing/seed.js';
import { dbError, testBackends, type TestDb } from './testing/test-db.js';

/**
 * E5 — intake persistence invariants on every backend, with the dirty-data regression fixture.
 */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const ruleSet = JSON.parse(
  readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
) as RuleSet;
const csv = readFileSync(root('fixtures/intake/dirty-cases.csv'), 'utf-8');
const intake = (text: string): IntakeResult =>
  runIntake({ sourceName: 'dirty-cases.csv', bytes: new TextEncoder().encode(text), ruleSet });
const fp = (s: string) => `sha256:${sha256Hex(s)}`;
const count = async (db: TestDb, sql: string, params: unknown[]) =>
  Number((await db.query<{ n: string }>(sql, params))[0]?.n);

for (const backend of testBackends()) {
  describe(`intake persistence — ${backend.name}`, () => {
    let db: TestDb;
    let t: Awaited<ReturnType<typeof newTournament>>;
    let result: IntakeResult;
    let saved: PersistIntakeOutcome;
    beforeAll(async () => {
      db = await backend.open();
      t = await newTournament(db);
      result = intake(csv);
      saved = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: t.tournament,
          ruleSetId: t.ruleSet,
          actorId: t.officer,
          result,
          nikKeys: TEST_NIK_KEYS,
          mode: 'INITIAL',
        }),
      );
    });
    afterAll(async () => db.close());

    it('persists everything in one transaction with counts equal to the intake result', async () => {
      const snapshot = result.snapshot;
      expect(snapshot).not.toBeNull();
      const [batch] = await db.query<{ status: string; row_count: number }>(
        'select status, row_count from import_batch where id = $1',
        [saved.batchId],
      );
      expect(batch).toEqual({ status: 'COMMITTED', row_count: 44 });
      expect(await count(db, 'select count(*) n from import_row where batch_id = $1', [saved.batchId])).toBe(
        44,
      );
      expect(
        await count(db, 'select count(*) n from field_transformation where batch_id = $1', [saved.batchId]),
      ).toBe(saved.counts.fieldTransformations);
      expect(saved.counts.fieldTransformations).toBeGreaterThan(0);
      expect(
        await count(db, 'select count(*) n from validation_issue where batch_id = $1', [saved.batchId]),
      ).toBe(result.issues.length);
      expect(await count(db, 'select count(*) n from athlete where tournament_id = $1', [t.tournament])).toBe(
        42,
      );
      expect(await count(db, 'select count(*) n from entry where tournament_id = $1', [t.tournament])).toBe(
        snapshot?.entries.length,
      );
      expect(
        await count(
          db,
          'select count(*) n from entry_group e join entry x on x.id = e.entry_id where x.tournament_id = $1',
          [t.tournament],
        ),
      ).toBe(1);
      expect(
        await count(
          db,
          `select count(*) n from validation_issue where batch_id = $1 and (rule_code is null or rule_provenance is null)`,
          [saved.batchId],
        ),
      ).toBe(0);
    });

    it('a failure rolls the whole intake back', async () => {
      const before = await count(db, 'select count(*) n from import_batch where tournament_id = $1', [
        t.tournament,
      ]);
      const err = await dbError(
        db.transaction(async (tx) => {
          await persistIntake(tx, {
            tournamentId: t.tournament,
            ruleSetId: t.ruleSet,
            actorId: t.officer,
            result,
            nikKeys: TEST_NIK_KEYS,
            mode: 'REIMPORT',
          });
          throw new Error('boom');
        }),
      );
      expect(err).toContain('boom');
      expect(
        await count(db, 'select count(*) n from import_batch where tournament_id = $1', [t.tournament]),
      ).toBe(before);
    });

    it('raw values are byte-identical; the batch content fingerprint is recomputable', async () => {
      const rows = await db.query<{
        row_number: number;
        raw: unknown;
        source_ref: string;
        normalized: { fields: { classOrFormat: { raw: string; value: string } } };
      }>(
        'select row_number, raw, source_ref, normalized from import_row where batch_id = $1 order by row_number',
        [saved.batchId],
      );
      expect(rows.map((r) => canonicalJson(r.raw))).toEqual(result.records.map((r) => canonicalJson(r.raw)));
      const formula = rows.find((r) => r.source_ref === 'REG013');
      expect((formula?.raw as Record<string, string>)['class']).toBe('=+53');
      expect(formula?.normalized.fields.classOrFormat).toMatchObject({ raw: '=+53', value: '+53' });
      expect(await verifyBatchContent(db, saved.batchId)).toBe(true);
    });

    it('field transformations keep raw, normalized, rule and provenance; suggestions are not applied', async () => {
      const [swap] = await db.query<{
        raw_value: string;
        normalized_value: string | null;
        outcome: string;
        resolution_status: string;
      }>(
        `select f.raw_value, f.normalized_value, f.outcome, f.resolution_status from field_transformation f
         join import_row r on r.id = f.import_row_id where r.batch_id = $1 and r.source_ref = 'REG013' and f.field = 'classOrFormat'`,
        [saved.batchId],
      );
      expect(swap).toEqual({
        raw_value: '=+53',
        normalized_value: '+53',
        outcome: 'NORMALIZED',
        resolution_status: 'UNRESOLVED',
      });
      const [suggested] = await db.query<{ suggestion: unknown; raw_value: string }>(
        `select i.suggestion, i.raw_value from validation_issue i join import_row r on r.id = i.subject_id
         where r.batch_id = $1 and r.source_ref = 'REG003' and i.code = 'HEIGHT_WEIGHT_LIKELY_SWAPPED'`,
        [saved.batchId],
      );
      expect(suggested?.suggestion).toEqual({
        rule: expect.any(String),
        alternatives: [{ tinggibadan: '160.00', beratbadan: '45.00' }],
      });
      const [athlete] = await db.query<{ registered_height_mm: number }>(
        `select registered_height_mm from athlete where tournament_id = $1 and person_ref like '%REG003'`,
        [t.tournament],
      );
      expect(athlete?.registered_height_mm).toBe(450);
    });

    it('NIK is stored encrypted with a blind index; the plaintext is recoverable only with the key', async () => {
      const rows = await db.query<{
        nik_ciphertext: Uint8Array;
        nik_blind_index: string;
        nik_format_valid: boolean;
        source_import_row_id: string;
      }>(
        'select nik_ciphertext, nik_blind_index, nik_format_valid, source_import_row_id from athlete where tournament_id = $1 and nik_ciphertext is not null',
        [t.tournament],
      );
      expect(rows.length).toBe(42);
      const raw = await db.query<{ id: string; normalized: { fields: { nik: { value: string } } } }>(
        'select id, normalized from import_row where batch_id = $1',
        [saved.batchId],
      );
      const nikOfRow = new Map(raw.map((r) => [r.id, r.normalized.fields.nik.value]));
      for (const a of rows) {
        const nik = nikOfRow.get(a.source_import_row_id) ?? '';
        expect(decryptNik(a.nik_ciphertext, TEST_NIK_KEYS)).toBe(nik);
        expect(a.nik_blind_index).toBe(nikBlindIndex(nik, TEST_NIK_KEYS));
        expect(Buffer.from(a.nik_ciphertext).toString('utf8')).not.toContain(nik);
        expect(a.nik_format_valid).toBe(/^\d{16}$/.test(nik));
      }
    });

    it('loadSnapshot returns the stored snapshot only if its fingerprint verifies', async () => {
      const loaded = await loadSnapshot(db, saved.snapshotId);
      expect(loaded.fingerprint).toBe(result.snapshotFingerprint);
      expect(canonicalJson(loaded.snapshot)).toBe(canonicalJson(result.snapshot));
    });

    describe('committed batch immutability', () => {
      it('batch, rows and transformations of a COMMITTED batch cannot change, be added or be deleted', async () => {
        const b = saved.batchId;
        expect(
          await dbError(db.query(`update import_batch set source_filename = 'x' where id = $1`, [b])),
        ).toContain('IMPORT_BATCH_IMMUTABLE');
        expect(await dbError(db.query(`delete from import_batch where id = $1`, [b]))).toContain(
          'IMPORT_BATCH_IMMUTABLE',
        );
        expect(
          await dbError(
            db.query(`update import_row set normalized = '{}' where batch_id = $1 and row_number = 2`, [b]),
          ),
        ).toContain('IMPORT_BATCH_IMMUTABLE');
        expect(
          await dbError(
            db.query(`update import_row set raw = '{}' where batch_id = $1 and row_number = 2`, [b]),
          ),
        ).toMatch(/IMPORT_(BATCH|ROW)_IMMUTABLE/);
        expect(
          await dbError(db.query(`delete from import_row where batch_id = $1 and row_number = 2`, [b])),
        ).toContain('IMPORT_ROW_IMMUTABLE');
        expect(
          await dbError(
            db.query(
              `insert into import_row (batch_id, row_number, source_ref, raw) values ($1, 999, 'NEW', '{}')`,
              [b],
            ),
          ),
        ).toContain('IMPORT_BATCH_IMMUTABLE');
        const [row] = await db.query<{ id: string }>(
          'select id from import_row where batch_id = $1 and row_number = 2',
          [b],
        );
        expect(
          await dbError(
            db.query(
              `insert into field_transformation (batch_id, import_row_id, field, raw_value, normalized_value, outcome, rule_code, rule_provenance)
               values ($1, $2, 'extra', 'a', 'a', 'NORMALIZED', 'X', 'ENGINEERING_DEFAULT')`,
              [b, row?.id],
            ),
          ),
        ).toContain('IMPORT_BATCH_IMMUTABLE');
        expect(await dbError(db.query('truncate import_row cascade'))).toContain('APPEND_ONLY_VIOLATION');
      });

      it('normalized is written once; a batch cannot commit with missing rows', async () => {
        const [batch] = await db.query<{ id: string }>(
          `insert into import_batch (tournament_id, rule_set_id, source_filename, source_sha256, row_count, column_mapping, adapter, created_by)
           values ($1, $2, 'open.csv', $3, 2, '{}', 'test', $4) returning id`,
          [t.tournament, t.ruleSet, sha256Hex('open'), t.officer],
        );
        const id = batch?.id;
        const [openRow] = await db.query<{ id: string }>(
          `insert into import_row (batch_id, row_number, source_ref, raw) values ($1, 2, 'A', '{"a":"1"}') returning id`,
          [id],
        );
        const transform = (batch: string | undefined, row: string | undefined, status: string) =>
          db.query(
            `insert into field_transformation (batch_id, import_row_id, field, raw_value, normalized_value, outcome, rule_code, rule_provenance, resolution_status)
             values ($1, $2, 'a', '1', '1', 'NORMALIZED', 'X', 'ENGINEERING_DEFAULT', $3)`,
            [batch, row, status],
          );
        expect(await dbError(transform(id, openRow?.id, 'ACCEPTED'))).toContain(
          'FIELD_TRANSFORMATION_RESOLUTION_ON_INSERT',
        );
        const [foreignRow] = await db.query<{ id: string }>(
          'select id from import_row where batch_id = $1 limit 1',
          [saved.batchId],
        );
        expect(await dbError(transform(id, foreignRow?.id, 'UNRESOLVED'))).toContain(
          'FIELD_TRANSFORMATION_BATCH_MISMATCH',
        );
        expect(await dbError(transform(id, openRow?.id, 'UNRESOLVED'))).toBe('NO_ERROR');
        await db.query(`update import_row set normalized = '{"v":1}' where batch_id = $1`, [id]);
        expect(
          await dbError(db.query(`update import_row set normalized = '{"v":2}' where batch_id = $1`, [id])),
        ).toContain('IMPORT_ROW_NORMALIZED_WRITTEN_ONCE');
        await db.query(`update import_batch set status = 'PARSED' where id = $1`, [id]);
        await db.query(`update import_batch set status = 'VALIDATED' where id = $1`, [id]);
        expect(
          await dbError(
            db.query(
              `update import_batch set status = 'COMMITTED', committed_at = now(), content_fingerprint = $2 where id = $1`,
              [id, fp('x')],
            ),
          ),
        ).toContain('IMPORT_BATCH_INCOMPLETE');
        await db.query(`update import_batch set status = 'FAILED' where id = $1`, [id]);
        expect(
          await dbError(db.query(`update import_row set normalized = null where batch_id = $1`, [id])),
        ).toContain('IMPORT_BATCH_IMMUTABLE');
      });

      it('SQL batch lifecycle equals the TypeScript state machine', async () => {
        const path: Record<ImportBatchStatus, ImportBatchStatus[]> = {
          UPLOADED: [],
          PARSED: ['PARSED'],
          VALIDATED: ['PARSED', 'VALIDATED'],
          COMMITTED: ['PARSED', 'VALIDATED', 'COMMITTED'],
          FAILED: ['FAILED'],
        };
        const set = (id: string, s: ImportBatchStatus) =>
          s === 'COMMITTED'
            ? db.query(
                `update import_batch set status = 'COMMITTED', committed_at = now(), content_fingerprint = $2 where id = $1`,
                [id, fp('[]')],
              )
            : db.query(`update import_batch set status = $2 where id = $1`, [id, s]);
        for (const from of IMPORT_BATCH_STATUSES) {
          for (const to of IMPORT_BATCH_STATUSES) {
            if (from === to) continue;
            const [b] = await db.query<{ id: string }>(
              `insert into import_batch (tournament_id, source_filename, source_sha256, row_count, column_mapping, adapter, created_by)
               values ($1, 'p.csv', $2, 0, '{}', 'test', $3) returning id`,
              [t.tournament, sha256Hex(`${from}${to}`), t.officer],
            );
            const id = b?.id ?? '';
            for (const s of path[from]) await set(id, s);
            const ok = (await dbError(set(id, to))) === 'NO_ERROR';
            expect(ok, `${from} -> ${to}`).toBe(canTransitionImportBatch(from, to));
          }
        }
        expect(
          await dbError(
            db.query(
              `insert into import_batch (tournament_id, source_filename, source_sha256, row_count, column_mapping, status, created_by) values ($1, 'c.csv', $2, 0, '{}', 'COMMITTED', $3)`,
              [t.tournament, sha256Hex('c'), t.officer],
            ),
          ),
        ).toContain('INVALID_IMPORT_BATCH_TRANSITION');
      });
    });

    describe('RAW → NORMALIZED → RESOLVED', () => {
      const transformation = async (ref: string, field: string) =>
        (
          await db.query<{ id: string }>(
            `select f.id from field_transformation f join import_row r on r.id = f.import_row_id where r.batch_id = $1 and r.source_ref = $2 and f.field = $3`,
            [saved.batchId, ref, field],
          )
        )[0]?.id ?? '';
      const resolve = (id: string, status: string, value: string | null, by: string, reason: string) =>
        db.query(
          `update field_transformation set resolution_status = $2, resolved_value = $3, resolved_by = $4, resolved_at = now(), resolution_reason = $5 where id = $1`,
          [id, status, value, by, reason],
        );

      it('a resolution is recorded once, by an authorized member, with a reason; raw never changes', async () => {
        const id = await transformation('REG013', 'classOrFormat');
        const outsider = await newTournament(db);
        const reason = 'Confirmed with the contingent manager by phone';
        expect(await dbError(resolve(id, 'ACCEPTED', '+53', t.viewer, reason))).toContain(
          'FIELD_TRANSFORMATION_RESOLVER_NOT_AUTHORIZED',
        );
        expect(await dbError(resolve(id, 'ACCEPTED', '+53', outsider.td, reason))).toContain(
          'FIELD_TRANSFORMATION_RESOLVER_NOT_AUTHORIZED',
        );
        expect(await dbError(resolve(id, 'ACCEPTED', '+53', t.td, 'too short'))).toContain(
          'field_transformation_reason_ck',
        );
        expect(await dbError(resolve(id, 'ACCEPTED', null, t.td, reason))).toContain(
          'field_transformation_resolved_value_ck',
        );
        expect(await dbError(resolve(id, 'ACCEPTED', '+53', t.td, reason))).toBe('NO_ERROR');
        expect(await dbError(resolve(id, 'REJECTED', null, t.td, reason))).toContain(
          'FIELD_TRANSFORMATION_RESOLUTION_FINAL',
        );
        expect(
          await dbError(db.query(`update field_transformation set raw_value = 'x' where id = $1`, [id])),
        ).toContain('FIELD_TRANSFORMATION_IMMUTABLE');
        expect(await dbError(db.query(`delete from field_transformation where id = $1`, [id]))).toContain(
          'FIELD_TRANSFORMATION_IMMUTABLE',
        );
        const [row] = await db.query<{
          raw_value: string;
          normalized_value: string;
          resolution_status: string;
          resolved_by: string;
        }>(
          'select raw_value, normalized_value, resolution_status, resolved_by from field_transformation where id = $1',
          [id],
        );
        expect(row).toEqual({
          raw_value: '=+53',
          normalized_value: '+53',
          resolution_status: 'ACCEPTED',
          resolved_by: t.td,
        });
      });

      it('REJECTED keeps the original and carries no value', async () => {
        const id = await transformation('REG007', 'nik');
        expect(
          await dbError(
            resolve(id, 'REJECTED', '3578', t.officer, 'Registration office confirmed the original NIK'),
          ),
        ).toContain('field_transformation_resolved_value_ck');
        expect(
          await dbError(
            resolve(id, 'REJECTED', null, t.officer, 'Registration office confirmed the original NIK'),
          ),
        ).toBe('NO_ERROR');
      });
    });

    describe('snapshots and draw runs', () => {
      it('a snapshot is append-only, derives from a committed batch and matches its content', async () => {
        expect(
          await dbError(
            db.query(`update intake_snapshot set entry_count = 0 where id = $1`, [saved.snapshotId]),
          ),
        ).toContain('APPEND_ONLY_VIOLATION');
        expect(
          await dbError(db.query(`delete from intake_snapshot where id = $1`, [saved.snapshotId])),
        ).toContain('APPEND_ONLY_VIOLATION');
        const [open] = await db.query<{ id: string }>(
          `insert into import_batch (tournament_id, source_filename, source_sha256, row_count, column_mapping, adapter, created_by)
           values ($1, 'o.csv', $2, 0, '{}', 'test', $3) returning id`,
          [t.tournament, sha256Hex('o'), t.officer],
        );
        const content = (sha: string, entries: unknown[]) =>
          JSON.stringify({
            schemaVersion: 1,
            adapter: 'test',
            ruleSetFingerprint: fp('r'),
            source: { fingerprint: `sha256:${sha}` },
            entries,
            excluded: [],
          });
        const insert = (batch: string | undefined, sha: string, n: number, entries: unknown[]) =>
          db.query(
            `insert into intake_snapshot (tournament_id, batch_id, rule_set_id, adapter, schema_version, rule_set_fingerprint, fingerprint, entry_count, content, created_by)
             values ($1, $2, $3, 'test', 1, $4, $4, $5, $6::jsonb, $7)`,
            [t.tournament, batch, t.ruleSet, fp('r'), n, content(sha, entries), t.officer],
          );
        expect(await dbError(insert(open?.id, sha256Hex('o'), 0, []))).toContain(
          'INTAKE_SNAPSHOT_BATCH_NOT_COMMITTED',
        );
        const [committed] = await db.query<{ source_sha256: string }>(
          'select source_sha256 from import_batch where id = $1',
          [saved.batchId],
        );
        expect(await dbError(insert(saved.batchId, committed?.source_sha256 ?? '', 5, []))).toContain(
          'INTAKE_SNAPSHOT_INCONSISTENT',
        );
        expect(await dbError(insert(saved.batchId, 'f'.repeat(64), 0, []))).toContain(
          'INTAKE_SNAPSHOT_INCONSISTENT',
        );
      });

      it('a draw run requires a snapshot of its own tournament and can never be re-bound', async () => {
        const run = (snapshot: string | null) =>
          db.query<{ id: string }>(
            `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, seed, engine_version, rules_snapshot, rules_fingerprint, input_fingerprint, params, scope, requested_by)
             values ($1, $2, $3, 'SIMULATION', '1', '0.1.0', '{}', $4, $4, '{}', '[]', $5) returning id`,
            [t.tournament, t.ruleSet, snapshot, fp('x'), t.officer],
          );
        expect(await dbError(run(null))).toContain('intake_snapshot_id');
        const other = await newTournament(db);
        const otherResult = await db.transaction((tx) =>
          persistIntake(tx, {
            tournamentId: other.tournament,
            ruleSetId: other.ruleSet,
            actorId: other.officer,
            result,
            nikKeys: TEST_NIK_KEYS,
            mode: 'INITIAL',
          }),
        );
        expect(await dbError(run(otherResult.snapshotId))).toMatch(/23503|foreign key/);
        const [ok] = await run(saved.snapshotId);
        expect(
          await dbError(
            db.query(`update draw_run set intake_snapshot_id = $2 where id = $1`, [
              ok?.id,
              otherResult.snapshotId,
            ]),
          ),
        ).toMatch(/DRAW_RUN_IMMUTABLE|23503|foreign key/);
      });
    });

    it('loadSnapshot refuses a snapshot altered behind the triggers (e.g. by a superuser)', async () => {
      const other = await newTournament(db);
      const o = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: other.tournament,
          ruleSetId: other.ruleSet,
          actorId: other.officer,
          result,
          nikKeys: TEST_NIK_KEYS,
          mode: 'INITIAL',
        }),
      );
      await db.query('alter table intake_snapshot disable trigger intake_snapshot_append_only');
      try {
        await db.query(
          `update intake_snapshot set content = jsonb_set(content, '{entries,0,externalRef}', '"TAMPERED"') where id = $1`,
          [o.snapshotId],
        );
      } finally {
        await db.query('alter table intake_snapshot enable trigger intake_snapshot_append_only');
      }
      expect(await dbError(loadSnapshot(db, o.snapshotId))).toContain('INTAKE_SNAPSHOT_FINGERPRINT_MISMATCH');
    });

    it('instruction 5: a re-import is a new batch and snapshot; old snapshots, runs and live entries are untouched', async () => {
      const before = await loadSnapshot(db, saved.snapshotId);
      const [run] = await db.query<{ id: string }>(
        `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, seed, engine_version, rules_snapshot, rules_fingerprint, input_fingerprint, params, scope, requested_by)
         values ($1, $2, $3, 'SIMULATION', '7', '0.1.0', '{}', $4, $5, '{}', '[]', $6) returning id`,
        [t.tournament, t.ruleSet, saved.snapshotId, fp('rules'), before.fingerprint, t.officer],
      );
      const entriesBefore = await db.query<{ external_ref: string; eligibility_status: string }>(
        'select external_ref, eligibility_status from entry where tournament_id = $1 order by external_ref',
        [t.tournament],
      );

      const lines = csv.split('\n').filter((l) => l !== '');
      const edited = lines
        .filter((l) => !l.startsWith('REG042,'))
        .map((l) => (l.startsWith('REG033,') ? l.replace(',155.00,45.00,', ',155.00,40.50,') : l));
      const next = intake(edited.join('\n'));
      expect(
        await dbError(
          db.transaction((tx) =>
            persistIntake(tx, {
              tournamentId: t.tournament,
              ruleSetId: t.ruleSet,
              actorId: t.officer,
              result: next,
              nikKeys: TEST_NIK_KEYS,
              mode: 'INITIAL',
            }),
          ),
        ),
      ).toContain('INITIAL_IMPORT_NOT_EMPTY');
      const re = await db.transaction((tx) =>
        persistIntake(tx, {
          tournamentId: t.tournament,
          ruleSetId: t.ruleSet,
          actorId: t.officer,
          result: next,
          nikKeys: TEST_NIK_KEYS,
          mode: 'REIMPORT',
        }),
      );
      expect(re.batchId).not.toBe(saved.batchId);
      expect(re.counts).toMatchObject({ importRows: 43, athletes: 0, entries: 0 });

      const after = await loadSnapshot(db, saved.snapshotId);
      expect(after.fingerprint).toBe(before.fingerprint);
      expect(canonicalJson(after.snapshot)).toBe(canonicalJson(before.snapshot));
      const [bound] = await db.query<{ intake_snapshot_id: string; input_fingerprint: string }>(
        'select intake_snapshot_id, input_fingerprint from draw_run where id = $1',
        [run?.id],
      );
      expect(bound).toEqual({ intake_snapshot_id: saved.snapshotId, input_fingerprint: before.fingerprint });
      expect(
        await db.query(
          'select external_ref, eligibility_status from entry where tournament_id = $1 order by external_ref',
          [t.tournament],
        ),
      ).toEqual(entriesBefore);

      const fresh = await loadSnapshot(db, re.snapshotId);
      expect(fresh.fingerprint).not.toBe(before.fingerprint);
      const d = diffIntake(before.snapshot, fresh.snapshot);
      expect(d.removed).toEqual(['REG042']);
      expect(d.changed.map((c) => c.externalRef)).toEqual(['REG033']);
      expect(
        await count(db, 'select count(*) n from validation_issue where batch_id = $1', [re.batchId]),
      ).toBe(next.issues.length);
    });
  });
}
