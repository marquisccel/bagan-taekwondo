import {
  createExportRequest,
  getExport,
  listExportsForRevision,
  type Db,
  type ExportArtifactRow,
} from '@bagantkd/db';
import {
  canExportInMode,
  canRequestExport,
  canViewExport,
  exportFormatFor,
  exportScopeFor,
  isSemiPrestasiOnlyExport,
  type RevisionLifecycle,
} from '@bagantkd/domain';
import {
  computeParametersFingerprint,
  computeSourceFingerprint,
  exportTemplateVersionFor,
  type ArtifactStorage,
} from '@bagantkd/export';
import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';

import type { Actor } from '../auth/actor';
import { ActorGuard } from '../auth/actor.guard';
import { CurrentActor } from '../auth/current-actor.decorator';
import { TournamentScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';
import { JOB_QUEUE, type JobQueue } from '../jobs/job-queue.module';
import { body, oneOf, strOrNull } from '../validation';
import { EXPORT_STORAGE } from './export-storage.module';

interface RevisionRow {
  readonly id: string;
  readonly tournament_id: string;
  readonly draw_run_id: string;
  readonly revision_no: number;
  readonly lifecycle: string;
  readonly content_fingerprint: string | null;
}

/** Never exposes the internal storage key or draw_run_id — those are implementation metadata, not client-facing identity. */
function toDto(row: ExportArtifactRow): Record<string, unknown> {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    revisionId: row.revisionId,
    revisionNo: row.revisionNo,
    exportType: row.exportType,
    format: row.format,
    mode: row.mode,
    scopeType: row.scopeType,
    categoryId: row.categoryId,
    poolId: row.poolId,
    status: row.status,
    sourceFingerprint: row.sourceFingerprint,
    parametersFingerprint: row.parametersFingerprint,
    outputFingerprint: row.outputFingerprint,
    fileSha256: row.fileSha256,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    errorCode: row.errorCode,
    requestedAt: row.requestedAt,
    generatedAt: row.generatedAt,
  };
}

/**
 * The smallest export API surface (Phase 6 ACCEPTANCE §13): request, inspect, list, download.
 * Lifecycle permission (`canExportInMode`) and role permission (`canRequestExport`) are both
 * domain-policy calls — this controller never decides for itself whether a mode/lifecycle
 * combination is allowed, exactly like `RevisionController` defers to `applyDrawCommand`.
 */
@Controller()
export class ExportController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(EXPORT_STORAGE) private readonly storage: ArtifactStorage,
  ) {}

  @Post('revisions/:id/exports')
  @UseGuards(ActorGuard)
  @TournamentScope('revision', 'id')
  async createExport(
    @Param('id') revisionId: string,
    @Body() raw: unknown,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const b = body(raw);
    const exportType = oneOf(b, 'exportType', [
      'TOURNAMENT_DRAW_BOOK',
      'CATEGORY_DRAW',
      'POOL_SHEET',
      'BRACKET_SHEET',
      'XLSX_WORKBOOK',
      'SEMI_PRESTASI_COMPACT_DRAW_SHEET',
    ] as const);
    const mode = oneOf(b, 'mode', ['PREVIEW', 'OFFICIAL'] as const);
    const categoryId = strOrNull(b, 'categoryId');
    const poolId = strOrNull(b, 'poolId');

    if (!canRequestExport(actor.role, mode)) {
      throw new ApiError('EXPORT_UNAUTHORIZED', `role ${actor.role} cannot request a ${mode} export`);
    }

    const [revision] = await this.db.query<RevisionRow>(
      `select id, tournament_id, draw_run_id, revision_no, lifecycle, content_fingerprint
       from draw_revision where id = $1`,
      [revisionId],
    );
    if (!revision) throw new ApiError('EXPORT_SOURCE_NOT_FOUND', 'revision not found');
    // revision.lifecycle is a raw-SQL `string`; RevisionLifecycle narrows it to the known enum values.
    if (!canExportInMode(revision.lifecycle as RevisionLifecycle, mode)) {
      throw new ApiError('EXPORT_REVISION_NOT_ALLOWED', `revision is ${revision.lifecycle}`);
    }

    const scopeType = exportScopeFor(exportType, categoryId !== null);
    if (scopeType === 'CATEGORY') {
      if (!categoryId) throw new ApiError('VALIDATION_ERROR', 'categoryId is required for this export type');
      const [row] = await this.db.query<{ id: string; stream: string }>(
        `select c.id, c.stream from draw_run_category rc join category c on c.id = rc.category_id
         where rc.draw_run_id = $1 and c.id = $2`,
        [revision.draw_run_id, categoryId],
      );
      if (!row) throw new ApiError('EXPORT_SOURCE_NOT_FOUND', 'category not found in this revision');
      if (isSemiPrestasiOnlyExport(exportType) && row.stream !== 'SEMI_PRESTASI') {
        throw new ApiError('VALIDATION_ERROR', 'this export type only supports semi-prestasi categories');
      }
    }
    if (scopeType === 'POOL') {
      if (!poolId) throw new ApiError('VALIDATION_ERROR', 'poolId is required for this export type');
      const [row] = await this.db.query<{ id: string }>(
        `select id from pool where revision_id = $1 and id = $2`,
        [revisionId, poolId],
      );
      if (!row) throw new ApiError('EXPORT_SOURCE_NOT_FOUND', 'pool not found in this revision');
    }
    if (scopeType === 'REVISION' && isSemiPrestasiOnlyExport(exportType)) {
      const [row] = await this.db.query<{ id: string }>(
        `select c.id from draw_run_category rc join category c on c.id = rc.category_id
         where rc.draw_run_id = $1 and c.stream = 'SEMI_PRESTASI' limit 1`,
        [revision.draw_run_id],
      );
      if (!row) throw new ApiError('VALIDATION_ERROR', 'this revision has no semi-prestasi categories');
    }

    const [run] = await this.db.query<{ engine_version: string }>(
      `select engine_version from draw_run where id = $1`,
      [revision.draw_run_id],
    );

    const format = exportFormatFor(exportType);
    const templateVersion = exportTemplateVersionFor(exportType);
    const sourceFingerprint = computeSourceFingerprint({
      revisionId,
      contentFingerprint: revision.content_fingerprint,
      scopeType,
      categoryId: scopeType === 'CATEGORY' ? categoryId : null,
      poolId: scopeType === 'POOL' ? poolId : null,
    });
    const parametersFingerprint = computeParametersFingerprint({
      exportType,
      format,
      mode,
      locale: 'id',
      templateVersion,
    });

    const { exportId } = await this.db.transaction((tx) =>
      createExportRequest(tx, {
        tournamentId: revision.tournament_id,
        drawRunId: revision.draw_run_id,
        revisionId,
        revisionNo: revision.revision_no,
        exportType,
        format,
        mode,
        scopeType,
        categoryId: scopeType === 'CATEGORY' ? categoryId : null,
        poolId: scopeType === 'POOL' ? poolId : null,
        sourceFingerprint,
        parametersFingerprint,
        engineVersion: run?.engine_version ?? 'unknown',
        templateVersion,
        requestedBy: actor.userId,
      }),
    );
    await this.jobs.enqueueExport(exportId);

    const row = await getExport(this.db, exportId);
    /* c8 ignore next -- row was just created/loaded inside the same call */
    if (!row) throw new ApiError('EXPORT_SOURCE_NOT_FOUND');
    return toDto(row);
  }

  @Get('revisions/:id/exports')
  @UseGuards(ActorGuard)
  @TournamentScope('revision', 'id')
  async listForRevision(@Param('id') revisionId: string): Promise<readonly Record<string, unknown>[]> {
    const rows = await listExportsForRevision(this.db, revisionId);
    return rows.map(toDto);
  }

  @Get('exports/:id')
  @UseGuards(ActorGuard)
  @TournamentScope('export', 'id')
  async get(@Param('id') id: string, @CurrentActor() actor: Actor): Promise<Record<string, unknown>> {
    if (!canViewExport(actor.role)) throw new ApiError('EXPORT_UNAUTHORIZED');
    const row = await getExport(this.db, id);
    if (!row) throw new ApiError('EXPORT_NOT_FOUND');
    return toDto(row);
  }

  @Get('exports/:id/file')
  @UseGuards(ActorGuard)
  @TournamentScope('export', 'id')
  async download(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
    @Res() res: { set(headers: Record<string, string>): void; send(body: Buffer): void },
  ): Promise<void> {
    if (!canViewExport(actor.role)) throw new ApiError('EXPORT_UNAUTHORIZED');
    const row = await getExport(this.db, id);
    if (!row) throw new ApiError('EXPORT_NOT_FOUND');
    if (row.status !== 'READY' || !row.storageKey || !row.filename) {
      throw new ApiError('EXPORT_NOT_READY', `export is ${row.status}`);
    }
    const bytes = await this.storage.read(row.storageKey);
    const contentType =
      row.format === 'PDF'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${row.filename}"`,
      'Content-Length': String(bytes.byteLength),
    });
    res.send(Buffer.from(bytes));
  }
}
