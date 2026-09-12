import { randomUUID } from 'node:crypto';

import {
  ADAPTER_KOLEKTIF_2026,
  KOLEKTIF_2026_COLUMNS,
  type IntakeIssue,
  type IntakeResult,
  type IntakeSnapshot,
  type NormalizedRow,
  type Person,
  type Trace,
} from '@bagantkd/intake';
import { deterministicUuid, DomainError, fingerprint, type Fingerprint } from '@bagantkd/shared';

import { encryptNik, nikBlindIndex, type NikKeys } from './nik-crypto.js';

/** The only database capability the repository needs; callers supply a transaction. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

/**
 * INITIAL: the tournament's first import — batch, rows, transformations, issues, snapshot AND the
 * live participant tables (contingents, athletes, entries, members, groups).
 * REIMPORT: batch, rows, transformations, issues and a new snapshot only. Live entries are never
 * touched; the difference is reported by diffIntake and applied by a reviewed command (Phase 4).
 */
export type IntakeMode = 'INITIAL' | 'REIMPORT';

export interface PersistIntakeArgs {
  readonly tournamentId: string;
  readonly ruleSetId: string;
  readonly actorId: string;
  readonly result: IntakeResult;
  readonly nikKeys: NikKeys;
  readonly mode: IntakeMode;
}

export interface PersistIntakeOutcome {
  readonly batchId: string;
  readonly snapshotId: string;
  readonly contentFingerprint: Fingerprint;
  readonly counts: {
    readonly importRows: number;
    readonly fieldTransformations: number;
    readonly validationIssues: number;
    readonly contingents: number;
    readonly athletes: number;
    readonly entries: number;
    readonly entryMembers: number;
    readonly entryGroups: number;
    readonly snapshotEntries: number;
  };
}

const CHUNK = 2000;

/** Inserts many rows in one statement per chunk: `insert … select * from jsonb_to_recordset($1)`. */
async function insertMany(
  tx: SqlExecutor,
  table: string,
  columns: readonly (readonly [name: string, type: string])[],
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  // A column named `<col>_hex` carries bytea as hex text and is decoded into `<col>`.
  const defs = columns.map(([n, t]) => `${n} ${t}`).join(', ');
  const select = columns
    .map(([n, t]) => (t === 'text' && n.endsWith('_hex') ? `decode(${n}, 'hex')` : n))
    .join(', ');
  const target = columns.map(([n]) => n.replace(/_hex$/, '')).join(', ');
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await tx.query(
      `insert into ${table} (${target}) select ${select} from jsonb_to_recordset($1::jsonb) as x(${defs})`,
      [JSON.stringify(chunk)],
    );
  }
}

/** Content fingerprint of a batch: every raw record in file order. Recomputable from import_row. */
export const batchContentFingerprint = (
  records: readonly { rowNumber: number; raw: unknown }[],
): Fingerprint => fingerprint(records.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw })));

const normalizedJson = (r: NormalizedRow) => ({
  ref: r.ref,
  fields: r.fields,
  stream: r.stream,
  discipline: r.discipline,
  format: r.format,
  weightClass: r.weightClass,
  templateCode: r.templateCode,
  heightUsable: r.heightUsable,
  weightUsable: r.weightUsable,
  birthYear: r.birthYear,
});

/**
 * Persists one intake result. Must run inside a single transaction supplied by the caller: either
 * everything is stored and the batch is COMMITTED with its snapshot, or nothing is.
 */
export async function persistIntake(tx: SqlExecutor, args: PersistIntakeArgs): Promise<PersistIntakeOutcome> {
  const { result, tournamentId } = args;
  if (
    result.fatal !== null ||
    result.snapshot === null ||
    result.snapshotFingerprint === null ||
    result.ruleSetFingerprint === null
  ) {
    throw new DomainError('INTAKE_NOT_PERSISTABLE', { fatal: result.fatal?.code ?? null });
  }
  const snapshot = result.snapshot;
  if (args.mode === 'INITIAL') {
    const [existing] = await tx.query<{ n: string }>(
      'select count(*)::text as n from entry where tournament_id = $1',
      [tournamentId],
    );
    if (existing?.n !== '0')
      throw new DomainError('INITIAL_IMPORT_NOT_EMPTY', { entries: existing?.n ?? null });
  }

  const batchId = randomUUID();
  const rowId = (ref: string) => deterministicUuid('bagantkd/import-row', `${batchId}|${ref}`);
  const athleteId = (personRef: string) =>
    deterministicUuid('bagantkd/athlete', `${tournamentId}|${personRef}`);
  const entryId = (externalRef: string) =>
    deterministicUuid('bagantkd/entry', `${tournamentId}|${externalRef}`);
  const contingentId = (name: string) => deterministicUuid('bagantkd/contingent', `${tournamentId}|${name}`);

  // 1. Batch (UPLOADED) and raw rows with their normalized trace (both written once).
  await tx.query(
    `insert into import_batch (id, tournament_id, rule_set_id, source_filename, source_sha256, row_count, column_mapping, adapter, created_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      batchId,
      tournamentId,
      args.ruleSetId,
      result.source.name,
      result.source.fingerprint.replace(/^sha256:/, ''),
      result.records.length,
      JSON.stringify({ adapter: ADAPTER_KOLEKTIF_2026, columns: KOLEKTIF_2026_COLUMNS }),
      ADAPTER_KOLEKTIF_2026,
      args.actorId,
    ],
  );
  const rowByNumber = new Map(result.rows.map((r) => [r.rowNumber, r]));
  await insertMany(
    tx,
    'import_row',
    [
      ['id', 'uuid'],
      ['batch_id', 'uuid'],
      ['row_number', 'int'],
      ['source_ref', 'text'],
      ['raw', 'jsonb'],
      ['normalized', 'jsonb'],
    ],
    result.records.map((rec) => {
      const row = rowByNumber.get(rec.rowNumber);
      if (!row) throw new DomainError('INTAKE_ROW_MISSING', { rowNumber: rec.rowNumber });
      return {
        id: rowId(row.ref),
        batch_id: batchId,
        row_number: rec.rowNumber,
        source_ref: row.ref,
        raw: rec.raw,
        normalized: normalizedJson(row),
      };
    }),
  );
  await tx.query(`update import_batch set status = 'PARSED' where id = $1`, [batchId]);

  // 2. RAW → NORMALIZED transformations: every normalized, invalid or suggested field.
  const transformations = result.rows.flatMap((row) =>
    (Object.entries(row.fields) as [string, Trace<string | number>][])
      .filter(([, t]) => t.outcome === 'NORMALIZED' || t.outcome === 'INVALID' || t.suggestion !== null)
      .map(([field, t]) => ({
        batch_id: batchId,
        import_row_id: rowId(row.ref),
        field,
        raw_value: t.raw,
        normalized_value: t.value === null ? null : String(t.value),
        outcome: t.outcome,
        rule_code: t.rule.code,
        rule_provenance: t.rule.provenance,
        suggestion: t.suggestion,
      })),
  );
  await insertMany(
    tx,
    'field_transformation',
    [
      ['batch_id', 'uuid'],
      ['import_row_id', 'uuid'],
      ['field', 'text'],
      ['raw_value', 'text'],
      ['normalized_value', 'text'],
      ['outcome', 'transformation_outcome'],
      ['rule_code', 'text'],
      ['rule_provenance', 'provenance_source'],
      ['suggestion', 'jsonb'],
    ],
    transformations,
  );

  // 3. Issues. Subjects point at live rows when they exist (INITIAL), else at the first source row;
  // the intake reference is always kept in params.subject.
  const persons = new Map(result.persons.map((p) => [p.ref, p]));
  const personOfRow = new Map<string, Person>();
  for (const p of result.persons) for (const r of p.rowRefs) personOfRow.set(r, p);
  const intakeEntries = new Map(result.entries.map((e) => [e.ref, e]));
  const materialized = new Set(args.mode === 'INITIAL' ? snapshot.entries.map((e) => e.externalRef) : []);
  const subjectOf = (i: IntakeIssue): { type: string; id: string } => {
    if (i.subject.kind === 'PERSON' && args.mode === 'INITIAL')
      return { type: 'ATHLETE', id: athleteId(i.subject.ref) };
    if (i.subject.kind === 'ENTRY' && materialized.has(i.subject.ref))
      return { type: 'ENTRY', id: entryId(i.subject.ref) };
    const firstRow =
      i.subject.kind === 'ROW'
        ? i.subject.ref
        : i.subject.kind === 'PERSON'
          ? persons.get(i.subject.ref)?.rowRefs[0]
          : intakeEntries.get(i.subject.ref)?.memberRows[0];
    if (firstRow === undefined) throw new DomainError('INTAKE_ISSUE_SUBJECT_UNKNOWN', { ref: i.subject.ref });
    return { type: 'IMPORT_ROW', id: rowId(firstRow) };
  };
  await insertMany(
    tx,
    'validation_issue',
    [
      ['tournament_id', 'uuid'],
      ['rule_set_id', 'uuid'],
      ['batch_id', 'uuid'],
      ['subject_type', 'subject_type'],
      ['subject_id', 'uuid'],
      ['code', 'text'],
      ['severity', 'issue_severity'],
      ['field', 'text'],
      ['component', 'text'],
      ['raw_value', 'text'],
      ['suggestion', 'jsonb'],
      ['rule_code', 'text'],
      ['rule_provenance', 'provenance_source'],
      ['params', 'jsonb'],
    ],
    result.issues.map((i) => {
      const s = subjectOf(i);
      return {
        tournament_id: tournamentId,
        rule_set_id: args.ruleSetId,
        batch_id: batchId,
        subject_type: s.type,
        subject_id: s.id,
        code: i.code,
        severity: i.severity,
        field: i.field,
        component: i.component,
        raw_value: i.raw,
        suggestion: i.suggestion,
        rule_code: i.rule.code,
        rule_provenance: i.rule.provenance,
        params: { ...i.params, subject: `${i.subject.kind}:${i.subject.ref}` },
      };
    }),
  );
  await tx.query(`update import_batch set status = 'VALIDATED' where id = $1`, [batchId]);

  // 4. Live participants (INITIAL only).
  let counts = { contingents: 0, athletes: 0, entries: 0, entryMembers: 0, entryGroups: 0 };
  if (args.mode === 'INITIAL') {
    const rowByRef = new Map(result.rows.map((r) => [r.ref, r]));
    const contingents = [...new Set(snapshot.entries.map((e) => e.contingentKey))];
    await insertMany(
      tx,
      'contingent',
      [
        ['id', 'uuid'],
        ['tournament_id', 'uuid'],
        ['name', 'text'],
      ],
      contingents.map((name) => ({ id: contingentId(name), tournament_id: tournamentId, name })),
    );

    // Registered values come from the source rows; a field that conflicts across a person's rows
    // is stored as null (the ATHLETE_ATTRIBUTE_CONFLICT issue and the raw rows keep every value).
    const athletes = result.persons.map((p) => {
      const first = rowByRef.get(p.rowRefs[0] ?? '');
      if (!first) throw new DomainError('INTAKE_PERSON_ROW_MISSING', { person: p.ref });
      const has = (f: string) => (p.conflicts as readonly string[]).includes(f);
      const f = first.fields;
      const nik = f.nik.value;
      return {
        id: athleteId(p.ref),
        tournament_id: tournamentId,
        person_ref: p.ref,
        full_name: has('FULL_NAME') ? null : f.name.value,
        gender: has('GENDER') ? null : f.gender.value,
        birth_date: has('BIRTH_DATE') ? null : f.birthDate.value,
        registered_height_mm: has('HEIGHT') ? null : f.heightMm.value,
        registered_weight_g: has('WEIGHT') ? null : f.weightG.value,
        registered_belt_code: has('BELT') ? null : f.belt.value,
        nik_ciphertext_hex: nik === null ? null : Buffer.from(encryptNik(nik, args.nikKeys)).toString('hex'),
        nik_blind_index: nik === null ? null : nikBlindIndex(nik, args.nikKeys),
        nik_format_valid: nik === null ? null : /^\d{16}$/.test(nik),
        source_import_row_id: rowId(first.ref),
      };
    });
    await insertMany(
      tx,
      'athlete',
      [
        ['id', 'uuid'],
        ['tournament_id', 'uuid'],
        ['person_ref', 'text'],
        ['full_name', 'text'],
        ['gender', 'gender'],
        ['birth_date', 'date'],
        ['registered_height_mm', 'int'],
        ['registered_weight_g', 'int'],
        ['registered_belt_code', 'text'],
        ['nik_ciphertext_hex', 'text'],
        ['nik_blind_index', 'text'],
        ['nik_format_valid', 'boolean'],
        ['source_import_row_id', 'uuid'],
      ],
      athletes,
    );

    const entries = snapshot.entries.map((e) => {
      const ie = intakeEntries.get(e.externalRef);
      return {
        id: entryId(e.externalRef),
        tournament_id: tournamentId,
        contingent_id: contingentId(e.contingentKey),
        external_ref: e.externalRef,
        import_row_id: ie?.memberRows[0] === undefined ? null : rowId(ie.memberRows[0]),
        declared_stream: e.stream,
        declared_discipline: e.discipline,
        declared_format: e.format,
        declared_age_division: e.ageDivisionCode,
        declared_class: e.weightClassCode,
        eligibility_status: e.eligibility,
        eligibility_reasons: e.blockingReasons,
      };
    });
    await insertMany(
      tx,
      'entry',
      [
        ['id', 'uuid'],
        ['tournament_id', 'uuid'],
        ['contingent_id', 'uuid'],
        ['external_ref', 'text'],
        ['import_row_id', 'uuid'],
        ['declared_stream', 'stream'],
        ['declared_discipline', 'discipline'],
        ['declared_format', 'entry_format'],
        ['declared_age_division', 'text'],
        ['declared_class', 'text'],
        ['eligibility_status', 'eligibility_status'],
        ['eligibility_reasons', 'jsonb'],
      ],
      entries,
    );

    const members = snapshot.entries.flatMap((e) =>
      (intakeEntries.get(e.externalRef)?.memberRows ?? []).map((ref, i) => {
        const p = personOfRow.get(ref);
        if (!p) throw new DomainError('INTAKE_MEMBER_PERSON_MISSING', { row: ref });
        return {
          entry_id: entryId(e.externalRef),
          athlete_id: athleteId(p.ref),
          tournament_id: tournamentId,
          position: i + 1,
        };
      }),
    );
    await insertMany(
      tx,
      'entry_member',
      [
        ['entry_id', 'uuid'],
        ['athlete_id', 'uuid'],
        ['tournament_id', 'uuid'],
        ['position', 'smallint'],
      ],
      members,
    );

    const groups = snapshot.entries.flatMap((e) => {
      const g = intakeEntries.get(e.externalRef)?.group;
      return g
        ? [
            {
              entry_id: entryId(e.externalRef),
              source: g.source,
              status: g.status,
              confidence: g.confidence,
              evidence: g.evidence,
            },
          ]
        : [];
    });
    await insertMany(
      tx,
      'entry_group',
      [
        ['entry_id', 'uuid'],
        ['source', 'entry_group_source'],
        ['status', 'entry_group_status'],
        ['confidence', 'confidence_level'],
        ['evidence', 'jsonb'],
      ],
      groups,
    );
    counts = {
      contingents: contingents.length,
      athletes: athletes.length,
      entries: entries.length,
      entryMembers: members.length,
      entryGroups: groups.length,
    };
  }

  // 5. Commit the batch (row count re-checked by trigger), then bind the immutable snapshot to it.
  const contentFingerprint = batchContentFingerprint(result.records);
  await tx.query(
    `update import_batch set status = 'COMMITTED', committed_at = now(), content_fingerprint = $2 where id = $1`,
    [batchId, contentFingerprint],
  );
  const snapshotId = randomUUID();
  await tx.query(
    `insert into intake_snapshot (id, tournament_id, batch_id, rule_set_id, adapter, schema_version, rule_set_fingerprint, fingerprint, entry_count, content, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      snapshotId,
      tournamentId,
      batchId,
      args.ruleSetId,
      snapshot.adapter,
      snapshot.schemaVersion,
      snapshot.ruleSetFingerprint,
      result.snapshotFingerprint,
      snapshot.entries.length,
      JSON.stringify(snapshot),
      args.actorId,
    ],
  );

  return {
    batchId,
    snapshotId,
    contentFingerprint,
    counts: {
      importRows: result.records.length,
      fieldTransformations: transformations.length,
      validationIssues: result.issues.length,
      ...counts,
      snapshotEntries: snapshot.entries.length,
    },
  };
}

/**
 * Loads a snapshot and proves it is the one that was stored: its canonical fingerprint must equal
 * the recorded one. A draw is only ever run on a verified snapshot.
 */
export async function loadSnapshot(
  db: SqlExecutor,
  snapshotId: string,
): Promise<{ snapshot: IntakeSnapshot; fingerprint: Fingerprint; batchId: string }> {
  const [row] = await db.query<{ content: IntakeSnapshot; fingerprint: string; batch_id: string }>(
    'select content, fingerprint, batch_id from intake_snapshot where id = $1',
    [snapshotId],
  );
  if (!row) throw new DomainError('INTAKE_SNAPSHOT_NOT_FOUND', { snapshotId });
  const actual = fingerprint(row.content);
  if (actual !== row.fingerprint) {
    throw new DomainError('INTAKE_SNAPSHOT_FINGERPRINT_MISMATCH', {
      snapshotId,
      stored: row.fingerprint,
      actual,
    });
  }
  return { snapshot: row.content, fingerprint: actual, batchId: row.batch_id };
}

/** Recomputes a batch's content fingerprint from its stored raw rows. */
export async function verifyBatchContent(db: SqlExecutor, batchId: string): Promise<boolean> {
  const [batch] = await db.query<{ content_fingerprint: string | null }>(
    'select content_fingerprint from import_batch where id = $1',
    [batchId],
  );
  const rows = await db.query<{ row_number: number; raw: unknown }>(
    'select row_number, raw from import_row where batch_id = $1 order by row_number',
    [batchId],
  );
  return (
    batch?.content_fingerprint ===
    batchContentFingerprint(rows.map((r) => ({ rowNumber: r.row_number, raw: r.raw })))
  );
}
