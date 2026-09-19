import { DomainError } from '@bagantkd/shared';

import type { Db } from './db.js';
import type { SqlExecutor } from './intake-repository.js';

export type ExportRowType =
  | 'TOURNAMENT_DRAW_BOOK'
  | 'CATEGORY_DRAW'
  | 'POOL_SHEET'
  | 'BRACKET_SHEET'
  | 'XLSX_WORKBOOK'
  | 'SEMI_PRESTASI_COMPACT_DRAW_SHEET';
export type ExportRowFormat = 'PDF' | 'XLSX';
export type ExportRowMode = 'PREVIEW' | 'OFFICIAL';
export type ExportRowStatus = 'REQUESTED' | 'GENERATING' | 'READY' | 'FAILED';
export type ExportRowScopeType = 'REVISION' | 'CATEGORY' | 'POOL';

export interface ExportArtifactRow {
  readonly id: string;
  readonly tournamentId: string;
  readonly drawRunId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly exportType: ExportRowType;
  readonly format: ExportRowFormat;
  readonly mode: ExportRowMode;
  readonly scopeType: ExportRowScopeType;
  readonly categoryId: string | null;
  readonly poolId: string | null;
  readonly status: ExportRowStatus;
  readonly sourceFingerprint: string;
  readonly parametersFingerprint: string;
  readonly outputFingerprint: string | null;
  readonly fileSha256: string | null;
  readonly engineVersion: string;
  readonly templateVersion: string;
  readonly storageKey: string | null;
  readonly filename: string | null;
  readonly sizeBytes: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly startedAt: Date | null;
  readonly generatedAt: Date | null;
}

interface ExportArtifactDbRow {
  readonly id: string;
  readonly tournament_id: string;
  readonly draw_run_id: string;
  readonly revision_id: string;
  readonly revision_no: number;
  readonly export_type: ExportRowType;
  readonly format: ExportRowFormat;
  readonly mode: ExportRowMode;
  readonly scope_type: ExportRowScopeType;
  readonly category_id: string | null;
  readonly pool_id: string | null;
  readonly status: ExportRowStatus;
  readonly source_fingerprint: string;
  readonly parameters_fingerprint: string;
  readonly output_fingerprint: string | null;
  readonly file_sha256: string | null;
  readonly engine_version: string;
  readonly template_version: string;
  readonly storage_key: string | null;
  readonly filename: string | null;
  readonly size_bytes: number | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly started_at: Date | null;
  readonly generated_at: Date | null;
}

function toRow(r: ExportArtifactDbRow): ExportArtifactRow {
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    drawRunId: r.draw_run_id,
    revisionId: r.revision_id,
    revisionNo: r.revision_no,
    exportType: r.export_type,
    format: r.format,
    mode: r.mode,
    scopeType: r.scope_type,
    categoryId: r.category_id,
    poolId: r.pool_id,
    status: r.status,
    sourceFingerprint: r.source_fingerprint,
    parametersFingerprint: r.parameters_fingerprint,
    outputFingerprint: r.output_fingerprint,
    fileSha256: r.file_sha256,
    engineVersion: r.engine_version,
    templateVersion: r.template_version,
    storageKey: r.storage_key,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    generatedAt: r.generated_at,
  };
}

const SELECT_COLUMNS = `id, tournament_id, draw_run_id, revision_id, revision_no, export_type, format, mode,
  scope_type, category_id, pool_id, status, source_fingerprint, parameters_fingerprint, output_fingerprint,
  file_sha256, engine_version, template_version, storage_key, filename, size_bytes, error_code, error_message,
  requested_by, requested_at, started_at, generated_at`;

export interface CreateExportRequestArgs {
  readonly tournamentId: string;
  readonly drawRunId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly exportType: ExportRowType;
  readonly format: ExportRowFormat;
  readonly mode: ExportRowMode;
  readonly scopeType: ExportRowScopeType;
  readonly categoryId: string | null;
  readonly poolId: string | null;
  /** Identifies the exact persisted revision content this export will read (packages/export/src/fingerprint.ts). */
  readonly sourceFingerprint: string;
  /** Identifies the normalized request itself: export type, format, mode, locale, template version. */
  readonly parametersFingerprint: string;
  readonly engineVersion: string;
  readonly templateVersion: string;
  readonly requestedBy: string;
}

/**
 * Creates a REQUESTED export row, or — if an export with the exact same source + parameters
 * fingerprints is already REQUESTED, GENERATING, or READY for this revision/scope — returns that
 * one unchanged instead of enqueueing duplicate work. This is what makes a client retry (double
 * click, redelivered request) safe: the same logical export is never generated twice, and a
 * previously FAILED attempt with the same fingerprints is deliberately NOT reused, so retrying
 * after a failure always gets a fresh row and a fresh generation attempt.
 */
export async function createExportRequest(
  tx: SqlExecutor,
  args: CreateExportRequestArgs,
): Promise<{ exportId: string; reused: boolean }> {
  const existing = await tx.query<{ id: string }>(
    `select id from export_artifact
     where revision_id = $1 and export_type = $2 and mode = $3 and scope_type = $4
       and category_id is not distinct from $5 and pool_id is not distinct from $6
       and source_fingerprint = $7 and parameters_fingerprint = $8
       and status in ('REQUESTED', 'GENERATING', 'READY')
     order by requested_at desc limit 1`,
    [
      args.revisionId,
      args.exportType,
      args.mode,
      args.scopeType,
      args.categoryId,
      args.poolId,
      args.sourceFingerprint,
      args.parametersFingerprint,
    ],
  );
  if (existing[0]) return { exportId: existing[0].id, reused: true };

  const rows = await tx.query<{ id: string }>(
    `insert into export_artifact (tournament_id, draw_run_id, revision_id, revision_no, export_type, format, mode,
       scope_type, category_id, pool_id, source_fingerprint, parameters_fingerprint, engine_version,
       template_version, requested_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id`,
    [
      args.tournamentId,
      args.drawRunId,
      args.revisionId,
      args.revisionNo,
      args.exportType,
      args.format,
      args.mode,
      args.scopeType,
      args.categoryId,
      args.poolId,
      args.sourceFingerprint,
      args.parametersFingerprint,
      args.engineVersion,
      args.templateVersion,
      args.requestedBy,
    ],
  );
  const row = rows[0];
  if (!row) throw new DomainError('EXPORT_ROW_MISSING', {}, 'expected row missing');
  return { exportId: row.id, reused: false };
}

/**
 * Atomically claims one REQUESTED export for rendering (`UPDATE ... WHERE status = 'REQUESTED'`),
 * exactly like `claimQueuedDrawRun`. Two workers (or a worker racing a reconciliation retry) can
 * only have one claim succeed — Postgres row-level locking makes the loser's UPDATE match zero
 * rows. Returns `null` if the export was already claimed, finished, or does not exist.
 */
export async function claimExport(db: Db, exportId: string): Promise<ExportArtifactRow | null> {
  const rows = await db.query<ExportArtifactDbRow>(
    `update export_artifact set status = 'GENERATING', started_at = now()
     where id = $1 and status = 'REQUESTED'
     returning ${SELECT_COLUMNS}`,
    [exportId],
  );
  const row = rows[0];
  return row ? toRow(row) : null;
}

export interface CompleteExportArgs {
  readonly storageKey: string;
  readonly filename: string;
  readonly sizeBytes: number;
  /** The semantic export fingerprint (deterministic logical content — see packages/export). */
  readonly outputFingerprint: string;
  /** sha256 of the final binary file bytes. */
  readonly fileSha256: string;
}

/**
 * Marks a GENERATING export READY with its storage location and fingerprints, atomically guarded
 * so only a genuinely GENERATING row can complete (never a REQUESTED row that skipped claiming, and
 * never twice). Returns `false` if the row had already left GENERATING — the caller (worker) should
 * treat that as "someone else already finished it" and discard the freshly rendered file rather
 * than erroring.
 */
export async function completeExport(db: Db, exportId: string, args: CompleteExportArgs): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `update export_artifact set status = 'READY', storage_key = $2, filename = $3, size_bytes = $4,
       output_fingerprint = $5, file_sha256 = $6, generated_at = now()
     where id = $1 and status = 'GENERATING'
     returning id`,
    [exportId, args.storageKey, args.filename, args.sizeBytes, args.outputFingerprint, args.fileSha256],
  );
  return rows.length > 0;
}

/**
 * Marks a GENERATING export FAILED with a stable machine-readable code. `errorMessage` must
 * already be a safe, operator-facing string picked by the caller (e.g. `e.message`) — never a raw
 * stack trace or renderer internals; nothing here sanitizes it. Atomically guarded like
 * `completeExport`; returns `false` if the row had already left GENERATING (e.g. two reconciliation
 * sweeps racing on the same stuck row — exactly one wins).
 */
export async function failExport(
  db: Db,
  exportId: string,
  errorCode: string,
  errorMessage: string,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `update export_artifact set status = 'FAILED', error_code = $2, error_message = $3
     where id = $1 and status = 'GENERATING'
     returning id`,
    [exportId, errorCode, errorMessage],
  );
  return rows.length > 0;
}

export async function getExport(db: Db, exportId: string): Promise<ExportArtifactRow | null> {
  const rows = await db.query<ExportArtifactDbRow>(
    `select ${SELECT_COLUMNS} from export_artifact where id = $1`,
    [exportId],
  );
  const row = rows[0];
  return row ? toRow(row) : null;
}

export async function listExportsForRevision(
  db: Db,
  revisionId: string,
): Promise<readonly ExportArtifactRow[]> {
  const rows = await db.query<ExportArtifactDbRow>(
    `select ${SELECT_COLUMNS} from export_artifact where revision_id = $1 order by requested_at desc`,
    [revisionId],
  );
  return rows.map(toRow);
}

/** REQUESTED exports older than `staleMs` — the enqueue message was lost, or a worker crashed before claiming. */
export async function findStaleRequestedExports(db: Db, staleMs: number): Promise<readonly string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from export_artifact where status = 'REQUESTED' and requested_at < now() - ($1 || ' milliseconds')::interval order by requested_at`,
    [staleMs],
  );
  return rows.map((r) => r.id);
}

/** GENERATING exports whose worker died mid-render (never reached READY/FAILED). */
export async function findStuckGeneratingExports(db: Db, staleMs: number): Promise<readonly string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from export_artifact where status = 'GENERATING' and started_at < now() - ($1 || ' milliseconds')::interval order by started_at`,
    [staleMs],
  );
  return rows.map((r) => r.id);
}

/**
 * Closes a stuck GENERATING export out as FAILED (found by `findStuckGeneratingExports`),
 * atomically guarded so only one reconciler wins if two race on the same orphan.
 */
export async function failStuckExport(db: Db, exportId: string, reason: string): Promise<boolean> {
  return failExport(db, exportId, 'EXPORT_GENERATION_FAILED', `worker timeout: ${reason}`);
}
