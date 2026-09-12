import { randomUUID } from 'node:crypto';

import {
  ISSUE_CATALOG,
  ISSUE_CODES,
  REGISTRATION_STATUSES,
  REVISION_ACTIONS,
  REVISION_LIFECYCLES,
  canChangeRegistration,
  nextLifecycle,
} from '@bagantkd/domain';
import { sha256Hex } from '@bagantkd/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newSnapshot } from './testing/seed.js';
import { dbError, testBackends, type TestDb } from './testing/test-db.js';

const fp = (s: string) => `sha256:${sha256Hex(s)}`;

/** Creates an isolated tournament with users, rule set, contingent, athlete, entry, run and DRAFT revision. */
async function seed(db: TestDb) {
  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params))[0] as T;
  const tag = randomUUID().slice(0, 8);
  const td = (
    await one<{ id: string }>(
      `insert into app_user (email, display_name, password_hash) values ($1, 'TD', 'x') returning id`,
      [`td-${tag}@t`],
    )
  ).id;
  const officer = (
    await one<{ id: string }>(
      `insert into app_user (email, display_name, password_hash) values ($1, 'Officer', 'x') returning id`,
      [`do-${tag}@t`],
    )
  ).id;
  const tournament = (
    await one<{ id: string }>(
      `insert into tournament (code, name, event_start, event_end, timezone) values ($1, 'T', '2026-08-27', '2026-08-30', 'Asia/Jakarta') returning id`,
      [`T_${tag}`],
    )
  ).id;
  await db.query(
    `insert into tournament_member (tournament_id, user_id, role) values ($1, $2, 'TECHNICAL_DELEGATE'), ($1, $3, 'DRAWING_OFFICER')`,
    [tournament, td, officer],
  );
  const ruleSet = (
    await one<{ id: string }>(
      `insert into rule_set (tournament_id, code, version, name, age_policy, age_reference_year, age_provenance, plausibility, source_vocabulary)
       values ($1, 'RS', 1, 'rs', 'BIRTH_YEAR', 2026, '{"source":"EVIDENCE_2026"}', '{}', '{}') returning id`,
      [tournament],
    )
  ).id;
  const contingent = (
    await one<{ id: string }>(
      `insert into contingent (tournament_id, name) values ($1, 'Kota Surabaya 2') returning id`,
      [tournament],
    )
  ).id;
  const athlete = (
    await one<{ id: string }>(
      `insert into athlete (tournament_id, full_name, gender, birth_date, registered_height_mm, registered_weight_g, registered_belt_code)
       values ($1, 'A', 'MALE', '2012-01-01', 1500, 45000, 'GEUP_7') returning id`,
      [tournament],
    )
  ).id;
  const newEntry = async (status = 'REGISTERED') =>
    (
      await one<{ id: string }>(
        `insert into entry (tournament_id, contingent_id, declared_stream, declared_discipline, declared_format, declared_age_division, registration_status)
         values ($1, $2, 'SEMI_PRESTASI', 'KYORUGI', 'INDIVIDUAL', 'CADET', $3) returning id`,
        [tournament, contingent, status],
      )
    ).id;
  const entryA = await newEntry();
  const entryB = await newEntry();
  const snapshot = await newSnapshot(db, tournament, ruleSet, officer);
  const drawRun = (
    await one<{ id: string }>(
      `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, status, seed, engine_version, rules_snapshot, rules_fingerprint, input_fingerprint, params, scope, requested_by)
       values ($1, $2, $6, 'CANDIDATE', 'RUNNING', '20260827', '0.1.0', '{}', $3, $4, '{}', '[]', $5) returning id`,
      [tournament, ruleSet, fp('rules'), fp('input'), officer, snapshot],
    )
  ).id;
  const revision = (
    await one<{ id: string }>(
      `insert into draw_revision (tournament_id, draw_run_id, revision_no, created_by) values ($1, $2, 1, $3) returning id`,
      [tournament, drawRun, officer],
    )
  ).id;
  return {
    td,
    officer,
    tournament,
    ruleSet,
    contingent,
    athlete,
    entryA,
    entryB,
    newEntry,
    snapshot,
    drawRun,
    revision,
    one,
  };
}

for (const backend of testBackends()) {
  describe(`database invariants — ${backend.name}`, () => {
    let db: TestDb;
    beforeAll(async () => {
      db = await backend.open();
      process.stdout.write(`  [db] backend: ${db.backend}\n`);
    });
    afterAll(async () => db.close());

    it('applies every migration and creates the expected tables', async () => {
      const tables = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
      );
      const names = tables.map((t) => t.table_name);
      for (const t of [
        'tournament',
        'rule_set',
        'rule_tolerance',
        'athlete',
        'entry',
        'entry_group',
        'validation_issue',
        'data_quality_override',
        'draw_run',
        'pool_candidate',
        'draw_revision',
        'pool',
        'pool_member',
        'bracket',
        'match',
        'match_code_registry',
        'draw_command',
        'audit_event',
        'complaint',
      ]) {
        expect(names).toContain(t);
      }
      const withoutPk = await db.query<{ table_name: string }>(
        `select t.table_name from information_schema.tables t where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and t.table_name not like '__drizzle%'
           and not exists (select 1 from information_schema.table_constraints c where c.table_name = t.table_name and c.constraint_type = 'PRIMARY KEY')`,
      );
      expect(withoutPk).toEqual([]);
    });

    describe('audit trail (INV-07)', () => {
      const insertEvent = (tournament: string, prev: string | null, hash: string) =>
        db.query(
          `insert into audit_event (chain_key, tournament_id, occurred_at, actor_kind, action, subject_type, prev_hash, hash)
           values ($1, $2, now(), 'SYSTEM', 'TEST', 'TOURNAMENT', $3, $4)`,
          [`tournament:${tournament}`, tournament, prev, hash],
        );

      it('accepts a linear hash chain and rejects forks', async () => {
        const s = await seed(db);
        expect(await dbError(insertEvent(s.tournament, fp('x'), fp('e1')))).toContain('AUDIT_CHAIN_BROKEN');
        await insertEvent(s.tournament, null, fp('e1'));
        expect(await dbError(insertEvent(s.tournament, null, fp('e2')))).toContain('AUDIT_CHAIN_BROKEN');
        expect(await dbError(insertEvent(s.tournament, fp('wrong'), fp('e2')))).toContain(
          'AUDIT_CHAIN_BROKEN',
        );
        await insertEvent(s.tournament, fp('e1'), fp('e2'));
        const head = await db.query<{ last_hash: string }>(
          `select last_hash from audit_chain_head where chain_key = $1`,
          [`tournament:${s.tournament}`],
        );
        expect(head[0]?.last_hash).toBe(fp('e2'));
      });

      it('is append-only', async () => {
        const s = await seed(db);
        await insertEvent(s.tournament, null, fp('only'));
        expect(
          await dbError(
            db.query(`update audit_event set action = 'X' where tournament_id = $1`, [s.tournament]),
          ),
        ).toContain('APPEND_ONLY_VIOLATION');
        expect(
          await dbError(db.query(`delete from audit_event where tournament_id = $1`, [s.tournament])),
        ).toContain('APPEND_ONLY_VIOLATION');
      });

      it('rejects a chain key that does not match the tournament', async () => {
        const s = await seed(db);
        const err = await dbError(
          db.query(
            `insert into audit_event (chain_key, tournament_id, occurred_at, actor_kind, action, subject_type, hash) values ('global', $1, now(), 'SYSTEM', 'X', 'TOURNAMENT', $2)`,
            [s.tournament, fp('g')],
          ),
        );
        expect(err).toContain('audit_event_chain_key_ck');
      });
    });

    describe('registered data', () => {
      it('never overwrites registered measurements', async () => {
        const s = await seed(db);
        expect(
          await dbError(
            db.query(`update athlete set registered_height_mm = 1340 where id = $1`, [s.athlete]),
          ),
        ).toContain('REGISTERED_VALUE_IMMUTABLE');
      });

      it('records corrections append-only with a reason', async () => {
        const s = await seed(db);
        expect(
          await dbError(
            db.query(
              `insert into measurement_correction (athlete_id, field, original_value, corrected_value, reason, actor_id) values ($1, 'HEIGHT', '7340', '1340', 'typo', $2)`,
              [s.athlete, s.td],
            ),
          ),
        ).toContain('measurement_correction_reason_ck');
        await db.query(
          `insert into measurement_correction (athlete_id, field, original_value, corrected_value, reason, actor_id) values ($1, 'HEIGHT', '7340', '1340', 'Re-measured at venue by TD', $2)`,
          [s.athlete, s.td],
        );
        expect(
          await dbError(db.query(`delete from measurement_correction where athlete_id = $1`, [s.athlete])),
        ).toContain('APPEND_ONLY_VIOLATION');
      });

      it('registration transitions match the domain state machine exactly', async () => {
        const s = await seed(db);
        for (const from of REGISTRATION_STATUSES) {
          for (const to of REGISTRATION_STATUSES) {
            if (from === to) continue;
            const id = await s.newEntry(from);
            const err = await dbError(
              db.query(`update entry set registration_status = $2 where id = $1`, [id, to]),
            );
            expect(err === 'NO_ERROR', `${from} -> ${to}`).toBe(canChangeRegistration(from, to));
          }
        }
      });

      it('an entry that withdrew can never be eligible', async () => {
        const s = await seed(db);
        const id = await s.newEntry('WITHDRAWN');
        expect(
          await dbError(db.query(`update entry set eligibility_status = 'READY' where id = $1`, [id])),
        ).toContain('entry_terminal_not_placeable_ck');
      });
    });

    describe('pair/team grouping (ADR-0010)', () => {
      it('a heuristic group cannot be confirmed without a confirming person', async () => {
        const s = await seed(db);
        expect(
          await dbError(
            db.query(
              `insert into entry_group (entry_id, source, status, confidence) values ($1, 'HEURISTIC', 'CONFIRMED', 'HIGH')`,
              [s.entryA],
            ),
          ),
        ).toContain('entry_group');
        await db.query(
          `insert into entry_group (entry_id, source, status, confidence) values ($1, 'HEURISTIC', 'PROPOSED', 'HIGH')`,
          [s.entryA],
        );
        await db.query(
          `update entry_group set status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() where entry_id = $1`,
          [s.entryA, s.officer],
        );
      });
    });

    describe('data-quality override (ADR-0011)', () => {
      const issue = async (s: Awaited<ReturnType<typeof seed>>, code: string, severity: string) =>
        (
          await s.one<{ id: string }>(
            `insert into validation_issue (tournament_id, subject_type, subject_id, code, severity) values ($1, 'ATHLETE', $2, $3, $4) returning id`,
            [s.tournament, s.athlete, code, severity],
          )
        ).id;
      const override = (issueId: string, actor: string) =>
        db.query(
          `insert into data_quality_override (issue_id, actor_id, reason) values ($1, $2, 'Height re-measured at venue: 134 cm')`,
          [issueId, actor],
        );

      it('only a Technical Delegate may override, only ERRORs, only overridable codes', async () => {
        const s = await seed(db);
        expect(await dbError(override(await issue(s, 'HEIGHT_OUT_OF_RANGE', 'ERROR'), s.officer))).toContain(
          'OVERRIDE_NOT_PERMITTED_FOR_ROLE',
        );
        expect(await dbError(override(await issue(s, 'BMI_IMPLAUSIBLE', 'WARNING'), s.td))).toContain(
          'OVERRIDE_ONLY_FOR_ERRORS',
        );
        expect(await dbError(override(await issue(s, 'UNKNOWN_CLASS', 'ERROR'), s.td))).toContain(
          'OVERRIDE_NOT_ALLOWED_FOR_CODE',
        );
      });

      it('an override marks the issue OVERRIDDEN, is immutable, and a revocation reopens it', async () => {
        const s = await seed(db);
        const id = await issue(s, 'HEIGHT_OUT_OF_RANGE', 'ERROR');
        await override(id, s.td);
        expect(
          (await db.query<{ status: string }>(`select status from validation_issue where id = $1`, [id]))[0]
            ?.status,
        ).toBe('OVERRIDDEN');
        expect(await dbError(override(id, s.td))).toContain('OVERRIDE_ISSUE_NOT_OPEN');
        expect(
          await dbError(
            db.query(
              `update data_quality_override set reason = 'something else entirely' where issue_id = $1`,
              [id],
            ),
          ),
        ).toContain('OVERRIDE_IMMUTABLE');
        await db.query(
          `update data_quality_override set revoked_at = now(), revoked_by = $2, revoke_reason = 'Official measurement disagrees' where issue_id = $1`,
          [id, s.td],
        );
        expect(
          (await db.query<{ status: string }>(`select status from validation_issue where id = $1`, [id]))[0]
            ?.status,
        ).toBe('OPEN');
        expect(
          await dbError(db.query(`delete from data_quality_override where issue_id = $1`, [id])),
        ).toContain('OVERRIDE_IMMUTABLE');
      });

      it('the SQL overridable-code list matches the domain catalog', async () => {
        for (const code of ISSUE_CODES) {
          const r = await db.query<{ ok: boolean }>(`select issue_code_overridable($1) as ok`, [code]);
          expect(r[0]?.ok, code).toBe(ISSUE_CATALOG[code].overridable);
        }
      });
    });

    describe('rule sets and tolerance model (ADR-0007)', () => {
      const policy = async (s: Awaited<ReturnType<typeof seed>>) =>
        (
          await s.one<{ id: string }>(
            `insert into rule_pool_policy (rule_set_id, code, pool_min, pool_target, pool_max, size_penalty_provenance, belt_policy, belt_provenance,
               tier1_slack_fp, contingent_weight_permille, bracket_weight_permille, tiers_provenance, singleton_policy, singleton_provenance,
               measurement_source, contingent_key, local_search_budget_per_entry)
             values ($1, 'P', 2, 4, 4, '{"source":"ENGINEERING_DEFAULT"}', 'SOFT', '{"source":"STAKEHOLDER"}', 500, 1000, 1000,
               '{"source":"ENGINEERING_DEFAULT"}', 'WALKOVER_WITH_SUGGESTIONS', '{"source":"STAKEHOLDER"}', 'REGISTERED_DATA', 'EXACT', 200) returning id`,
            [s.ruleSet],
          )
        ).id;
      const tolerance = (policyId: string, status: string, value: number | null, prov: string | null) =>
        db.query(
          `insert into rule_tolerance (policy_id, dimension, active, ideal, ideal_provenance, max_status, max_value, max_provenance, linear_weight_permille, overflow_weight_permille)
           values ($1, 'HEIGHT', true, 50, '{"source":"STAKEHOLDER"}', $2, $3, $4, 1000, 4000)`,
          [policyId, status, value, prov],
        );

      it('UNSET max carries no value; SET max needs a value at least the ideal', async () => {
        const s = await seed(db);
        const p = await policy(s);
        expect(await dbError(tolerance(p, 'SET', null, '{"source":"COMMITTEE"}'))).toContain(
          'rule_tolerance_max_value_ck',
        );
        expect(await dbError(tolerance(p, 'UNSET', 140, null))).toContain('rule_tolerance_max_value_ck');
        expect(await dbError(tolerance(p, 'SET', 40, '{"source":"COMMITTEE"}'))).toContain(
          'rule_tolerance_max_ge_ideal_ck',
        );
        await tolerance(p, 'UNSET', null, null);
      });

      it('an activated rule set and its children are frozen', async () => {
        const s = await seed(db);
        const p = await policy(s);
        expect(
          await dbError(db.query(`update rule_set set status = 'ACTIVE' where id = $1`, [s.ruleSet])),
        ).toContain('rule_set_active_frozen_ck');
        await db.query(
          `update rule_set set status = 'ACTIVE', snapshot = '{}', fingerprint = $2, activated_at = now() where id = $1`,
          [s.ruleSet, fp('rs')],
        );
        expect(
          await dbError(db.query(`update rule_set set name = 'changed' where id = $1`, [s.ruleSet])),
        ).toContain('RULE_SET_FROZEN');
        expect(await dbError(tolerance(p, 'UNSET', null, null))).toContain('RULE_SET_FROZEN');
        expect(
          await dbError(db.query(`update rule_set set status = 'DRAFT' where id = $1`, [s.ruleSet])),
        ).toContain('INVALID_RULE_SET_TRANSITION');
      });
    });

    describe('draw runs', () => {
      it('a candidate run cannot carry simulation assumptions', async () => {
        const s = await seed(db);
        const err = await dbError(
          db.query(
            `insert into draw_run (tournament_id, rule_set_id, intake_snapshot_id, kind, seed, engine_version, rules_snapshot, rules_fingerprint, input_fingerprint, params, assumptions, scope, requested_by)
             values ($1, $2, $5, 'CANDIDATE', '1', '0.1.0', '{}', $3, $3, '{}', '{"maxTolerances":[]}', '[]', $4)`,
            [s.tournament, s.ruleSet, fp('a'), s.officer, s.snapshot],
          ),
        );
        expect(err).toContain('draw_run_candidate_no_assumptions_ck');
      });

      it('a SAFE candidate needs a matching dual run, and a finished run is immutable', async () => {
        const s = await seed(db);
        expect(
          await dbError(
            db.query(
              `update draw_run set status = 'SAFE', output_fingerprint = $2, finished_at = now() where id = $1`,
              [s.drawRun, fp('o')],
            ),
          ),
        ).toContain('draw_run_candidate_dual_run_ck');
        await db.query(
          `update draw_run set status = 'SAFE', output_fingerprint = $2, dual_run_match = true, finished_at = now() where id = $1`,
          [s.drawRun, fp('o')],
        );
        expect(
          await dbError(db.query(`update draw_run set duration_ms = 1 where id = $1`, [s.drawRun])),
        ).toContain('DRAW_RUN_IMMUTABLE');
        expect(await dbError(db.query(`delete from draw_run where id = $1`, [s.drawRun]))).toContain(
          'DRAW_RUN_IMMUTABLE',
        );
      });

      it('keeps every strategy candidate but at most one selected, and never a selected one with hard violations', async () => {
        const s = await seed(db);
        const cat = (
          await s.one<{ id: string }>(
            `with d as (insert into rule_age_division (rule_set_id, code, label, streams, min_birth_year, max_birth_year, ord, play_up_policy, provenance)
                        values ($1, 'CADET', 'Cadet', '{SEMI_PRESTASI}', 2012, 2014, 4, 'FORBID', '{"source":"EVIDENCE_2026"}') returning id),
                  t as (insert into rule_category_template (rule_set_id, code, stream, discipline, format, gender_mode, dimensions, draw_format, bye_policy, bronze_medals, provenance)
                        values ($1, 'K', 'PRESTASI', 'KYORUGI', 'INDIVIDUAL', 'BY_ENTRY', '{STREAM,WEIGHT_CLASS}', 'SINGLE_ELIMINATION', 'SEED_PRIORITY', 2, '{"source":"COMMITTEE"}') returning id)
             insert into category (tournament_id, rule_set_id, template_id, category_key, stream, discipline, format, age_division_id, gender)
             select $2, $1, t.id, 'K|CADET|MALE|-41', 'PRESTASI', 'KYORUGI', 'INDIVIDUAL', d.id, 'MALE' from d, t returning id`,
            [s.ruleSet, s.tournament],
          )
        ).id;
        await db.query(
          `insert into draw_run_category (draw_run_id, category_id, readiness) values ($1, $2, 'READY')`,
          [s.drawRun, cat],
        );
        const cand = (strategy: string, rank: number, selected: boolean, t0: number) =>
          db.query(
            `insert into pool_candidate (draw_run_id, category_id, strategy, rank, selected, tier0_violations, tier1_cost_fp, tier2_cost_fp, partition, metrics)
             values ($1, $2, $3, $4, $5, $6, 0, 0, '[]', '{}')`,
            [s.drawRun, cat, strategy, rank, selected, t0],
          );
        await cand('WEIGHT_FIRST', 1, true, 0);
        await cand('HEIGHT_FIRST', 2, false, 3);
        expect(await dbError(cand('BELT_FIRST', 3, true, 0))).toContain('pool_candidate_one_selected_uq');
        expect(
          await dbError(
            cand('BALANCED', 4, false, 0).then(() =>
              db.query(
                `update pool_candidate set selected = true where strategy = 'HEIGHT_FIRST' and draw_run_id = $1`,
                [s.drawRun],
              ),
            ),
          ),
        ).toMatch(/pool_candidate_(selected_valid_ck|one_selected_uq)/);
      });
    });

    describe('revisions (INV-02, INV-04, INV-06)', () => {
      const makePool = async (s: Awaited<ReturnType<typeof seed>>, revision: string, ordinal: number) => {
        const cat = await s.one<{ id: string }>(`select id from category where tournament_id = $1 limit 1`, [
          s.tournament,
        ]);
        return (
          await s.one<{ id: string }>(
            `insert into pool (revision_id, pool_uid, category_id, ordinal, is_walkover, metrics, explanation) values ($1, $2, $3, $4, false, '{}', '[]') returning id`,
            [revision, randomUUID(), cat.id, ordinal],
          )
        ).id;
      };
      const withCategory = async () => {
        const s = await seed(db);
        await db.query(
          `with d as (insert into rule_age_division (rule_set_id, code, label, streams, min_birth_year, max_birth_year, ord, play_up_policy, provenance)
                      values ($1, 'CADET', 'Cadet', '{SEMI_PRESTASI}', 2012, 2014, 4, 'FORBID', '{"source":"EVIDENCE_2026"}') returning id),
                t as (insert into rule_category_template (rule_set_id, code, stream, discipline, format, gender_mode, dimensions, draw_format, bye_policy, bronze_medals, provenance)
                      values ($1, 'K', 'PRESTASI', 'KYORUGI', 'INDIVIDUAL', 'BY_ENTRY', '{STREAM,WEIGHT_CLASS}', 'SINGLE_ELIMINATION', 'SEED_PRIORITY', 2, '{"source":"COMMITTEE"}') returning id)
           insert into category (tournament_id, rule_set_id, template_id, category_key, stream, discipline, format, age_division_id, gender)
           select $2, $1, t.id, 'K|CADET|MALE|-41', 'PRESTASI', 'KYORUGI', 'INDIVIDUAL', d.id, 'MALE' from d, t`,
          [s.ruleSet, s.tournament],
        );
        return s;
      };
      const setLifecycle = (revision: string, lifecycle: string, extra = '') =>
        db.query(
          `update draw_revision set lifecycle = $2, lock_version = lock_version + 1 ${extra} where id = $1`,
          [revision, lifecycle],
        );

      it('an entry appears at most once per revision', async () => {
        const s = await withCategory();
        const p1 = await makePool(s, s.revision, 1);
        const p2 = await makePool(s, s.revision, 2);
        await db.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1, $2, $3)`, [
          p1,
          s.revision,
          s.entryA,
        ]);
        expect(
          await dbError(
            db.query(`insert into pool_member (pool_id, revision_id, entry_id) values ($1, $2, $3)`, [
              p2,
              s.revision,
              s.entryA,
            ]),
          ),
        ).toContain('pool_member_once_per_revision_uq');
      });

      it('brackets must be structurally valid', async () => {
        const s = await withCategory();
        const p = await makePool(s, s.revision, 1);
        const bracket = (size: number, rounds: number, entries: number, byes: number) =>
          db.query(
            `insert into bracket (pool_id, revision_id, size, rounds, entries, byes) values ($1, $2, $3, $4, $5, $6)`,
            [p, s.revision, size, rounds, entries, byes],
          );
        expect(await dbError(bracket(6, 3, 5, 1))).toContain('bracket_power_of_two_ck');
        expect(await dbError(bracket(8, 3, 5, 2))).toContain('bracket_byes_ck');
        expect(await dbError(bracket(8, 2, 5, 3))).toContain('bracket_rounds_ck');
        await bracket(8, 3, 5, 3);
      });

      it('lifecycle transitions in SQL match the domain state machine exactly', async () => {
        const allowed = new Set<string>();
        for (const from of REVISION_LIFECYCLES) {
          for (const a of REVISION_ACTIONS) {
            const to = nextLifecycle(from, a);
            if (to) allowed.add(`${from}->${to}`);
          }
        }
        for (const from of REVISION_LIFECYCLES) {
          for (const to of REVISION_LIFECYCLES) {
            if (from === to) continue;
            const r = await db.query<{ ok: boolean }>(`select revision_transition_allowed($1, $2) as ok`, [
              from,
              to,
            ]);
            expect(r[0]?.ok, `${from} -> ${to}`).toBe(allowed.has(`${from}->${to}`));
          }
        }
      });

      it('requires lock_version to increment and refuses illegal transitions', async () => {
        const s = await withCategory();
        expect(
          await dbError(
            db.query(`update draw_revision set lifecycle = 'REVIEW' where id = $1`, [s.revision]),
          ),
        ).toContain('REVISION_CONFLICT');
        expect(await dbError(setLifecycle(s.revision, 'LOCKED'))).toMatch(
          /INVALID_REVISION_TRANSITION|draw_revision_locked_ck/,
        );
      });

      it('content is frozen outside DRAFT and only a PUBLISHED revision can become official', async () => {
        const s = await withCategory();
        await makePool(s, s.revision, 1);
        await setLifecycle(s.revision, 'REVIEW', ', submitted_at = now()');
        expect(await dbError(makePool(s, s.revision, 2))).toContain('REVISION_CONTENT_FROZEN');
        const cat = await s.one<{ id: string }>(`select id from category where tournament_id = $1`, [
          s.tournament,
        ]);
        expect(
          await dbError(
            db.query(`insert into official_category_assignment (category_id, revision_id) values ($1, $2)`, [
              cat.id,
              s.revision,
            ]),
          ),
        ).toContain('OFFICIAL_REVISION_NOT_PUBLISHED');
        await setLifecycle(
          s.revision,
          'APPROVED',
          ', approved_at = now(), approved_by = $2'.replace('$2', `'${s.td}'`),
        );
        await setLifecycle(
          s.revision,
          'LOCKED',
          `, locked_at = now(), locked_by = '${s.td}', content_fingerprint = '${fp('c')}'`,
        );
        expect(
          await dbError(
            db.query(
              `update draw_revision set content_fingerprint = $2, lock_version = lock_version + 1 where id = $1`,
              [s.revision, fp('d')],
            ),
          ),
        ).toContain('REVISION_CONTENT_FROZEN');
        await setLifecycle(s.revision, 'PUBLISHED', `, published_at = now(), published_by = '${s.td}'`);
        await db.query(
          `insert into official_category_assignment (category_id, revision_id) values ($1, $2)`,
          [cat.id, s.revision],
        );
        expect(await dbError(db.query(`delete from draw_revision where id = $1`, [s.revision]))).toContain(
          'REVISION_IMMUTABLE',
        );
      });
    });

    describe('public match codes (ADR-0005)', () => {
      it('are never deleted, reused or re-assigned; retirement happens once', async () => {
        const s = await seed(db);
        const arena = (
          await s.one<{ id: string }>(
            `insert into arena (tournament_id, code, name) values ($1, 'C', 'Arena C') returning id`,
            [s.tournament],
          )
        ).id;
        const uid = randomUUID();
        await db.query(
          `insert into match_code_registry (tournament_id, public_code, arena_id, match_uid, first_revision_id) values ($1, 'C001', $2, $3, $4)`,
          [s.tournament, arena, uid, s.revision],
        );
        expect(
          await dbError(
            db.query(
              `insert into match_code_registry (tournament_id, public_code, arena_id, match_uid, first_revision_id) values ($1, 'C001', $2, $3, $4)`,
              [s.tournament, arena, randomUUID(), s.revision],
            ),
          ),
        ).toContain('23505');
        expect(
          await dbError(
            db.query(`update match_code_registry set public_code = 'C002' where match_uid = $1`, [uid]),
          ),
        ).toContain('MATCH_CODE_IMMUTABLE');
        await db.query(`update match_code_registry set retired_revision_id = $2 where match_uid = $1`, [
          uid,
          s.revision,
        ]);
        expect(
          await dbError(
            db.query(`update match_code_registry set retired_revision_id = null where match_uid = $1`, [uid]),
          ),
        ).toContain('MATCH_CODE_IMMUTABLE');
        expect(
          await dbError(db.query(`delete from match_code_registry where match_uid = $1`, [uid])),
        ).toContain('MATCH_CODE_IMMUTABLE');
      });
    });

    describe('CHECK constraints are not bypassed by NULL (three-valued logic)', () => {
      it('audit event without tournament must use the global chain', async () => {
        expect(
          await dbError(
            db.query(
              `insert into audit_event (chain_key, occurred_at, actor_kind, action, subject_type, hash) values ('tournament:x', now(), 'SYSTEM', 'X', 'TOURNAMENT', $1)`,
              [fp('n1')],
            ),
          ),
        ).toContain('audit_event_chain_key_ck');
      });

      it('an override cannot be revoked without a reason', async () => {
        const s = await seed(db);
        const issueId = (
          await s.one<{ id: string }>(
            `insert into validation_issue (tournament_id, subject_type, subject_id, code, severity) values ($1, 'ATHLETE', $2, 'HEIGHT_OUT_OF_RANGE', 'ERROR') returning id`,
            [s.tournament, s.athlete],
          )
        ).id;
        await db.query(
          `insert into data_quality_override (issue_id, actor_id, reason) values ($1, $2, 'Height re-measured at venue: 134 cm')`,
          [issueId, s.td],
        );
        expect(
          await dbError(
            db.query(
              `update data_quality_override set revoked_at = now(), revoked_by = $2 where issue_id = $1`,
              [issueId, s.td],
            ),
          ),
        ).toContain('data_quality_override_revocation_ck');
      });

      it('an elimination template must declare its bronze-medal count', async () => {
        const s = await seed(db);
        expect(
          await dbError(
            db.query(
              `insert into rule_category_template (rule_set_id, code, stream, discipline, format, gender_mode, dimensions, draw_format, bye_policy, bronze_medals, provenance)
               values ($1, 'X', 'PRESTASI', 'POOMSAE', 'TEAM', 'BY_ENTRY', '{STREAM}', 'SINGLE_ELIMINATION', 'SEED_PRIORITY', null, '{"source":"COMMITTEE"}')`,
              [s.ruleSet],
            ),
          ),
        ).toContain('rule_category_template_elimination_ck');
      });
    });

    describe('commands and complaints', () => {
      it('commands are idempotent by key and append-only', async () => {
        const s = await seed(db);
        const cmd = () =>
          db.query(
            `insert into draw_command (tournament_id, base_revision_id, type, payload, expected_lock_version, idempotency_key, actor_id, outcome, rejection_code, verdict)
             values ($1, $2, 'MOVE_ENTRY', '{}', 0, 'key-00000001', $3, 'REJECTED', 'REVISION_CONFLICT', '{"level":"RED"}')`,
            [s.tournament, s.revision, s.officer],
          );
        await cmd();
        expect(await dbError(cmd())).toContain('draw_command_idempotency_uq');
        expect(
          await dbError(
            db.query(`update draw_command set reason = 'x' where tournament_id = $1`, [s.tournament]),
          ),
        ).toContain('APPEND_ONLY_VIOLATION');
      });

      it('an accepted complaint must reference the resulting command or revision', async () => {
        const s = await seed(db);
        const err = await dbError(
          db.query(
            `insert into complaint (tournament_id, filed_by_name, subject_type, reason, status, decision, decided_by, decided_at) values ($1, 'Manager', 'POOL', 'wrong pool', 'ACCEPTED', 'Moved', $2, now())`,
            [s.tournament, s.td],
          ),
        );
        expect(err).toContain('complaint_resolution_ref_ck');
        const c = (
          await s.one<{ id: string }>(
            `insert into complaint (tournament_id, filed_by_name, subject_type, reason) values ($1, 'Manager', 'POOL', 'wrong pool') returning id`,
            [s.tournament],
          )
        ).id;
        expect(
          await dbError(db.query(`update complaint set status = 'RESOLVED' where id = $1`, [c])),
        ).toContain('INVALID_COMPLAINT_TRANSITION');
      });
    });
  });
}
