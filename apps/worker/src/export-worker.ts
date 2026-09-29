import {
  claimExport,
  completeExport,
  failExport,
  loadExportModel,
  loadScheduleSlotForDrawRun,
  type Db,
  type ExportArtifactRow,
} from '@bagantkd/db';
import {
  computeFileSha256,
  computeSemanticExportFingerprint,
  exportFilename,
  type ArtifactStorage,
  type ExportCategory,
  type ExportModel,
  type ExportPool,
  type ScheduleSlot,
  semiPrestasiFingerprintSubject,
} from '@bagantkd/export';
import {
  renderBracketSheetPdf,
  renderCategoryDrawPdf,
  renderPoolSheetPdf,
  renderSemiPrestasiCompactDrawSheetPdf,
  renderSemiPrestasiSessionDrawSheetPdf,
  renderTournamentDrawBookPdf,
  type RenderOptions,
} from '@bagantkd/export/pdf';
import { buildExportWorkbook } from '@bagantkd/export/xlsx';
import type { PgBoss, Job } from 'pg-boss';

export const EXPORT_QUEUE = 'export';

interface ScopedTarget {
  readonly category: ExportCategory | null;
  readonly pool: ExportPool | null;
  /** The exact sub-content this artifact's semantic fingerprint is computed from — never the whole model for a scoped document. */
  readonly fingerprintSubject: unknown;
}

function resolveScope(model: ExportModel, row: ExportArtifactRow): ScopedTarget {
  if (row.exportType === 'SEMI_PRESTASI_COMPACT_DRAW_SHEET') {
    // Covers only its own (semi-prestasi) categories; a category-scoped row must name a semi-prestasi one.
    const categoryId = row.scopeType === 'CATEGORY' ? row.categoryId : null;
    const category = categoryId ? (model.categories.find((c) => c.id === categoryId) ?? null) : null;
    return {
      category,
      pool: null,
      fingerprintSubject: semiPrestasiFingerprintSubject(model, categoryId),
    };
  }
  if (row.scopeType === 'REVISION') {
    return { category: null, pool: null, fingerprintSubject: model };
  }
  if (row.scopeType === 'CATEGORY') {
    const category = model.categories.find((c) => c.id === row.categoryId) ?? null;
    if (!category) throw new Error(`category ${row.categoryId} not found in export model`);
    return {
      category,
      pool: null,
      fingerprintSubject: { tournament: model.tournament, revision: model.revision, category },
    };
  }
  const category = model.categories.find((c) => c.pools.some((p) => p.id === row.poolId)) ?? null;
  const pool = category?.pools.find((p) => p.id === row.poolId) ?? null;
  if (!category || !pool) throw new Error(`pool ${row.poolId} not found in export model`);
  return {
    category,
    pool,
    fingerprintSubject: { tournament: model.tournament, revision: model.revision, pool },
  };
}

function renderBytes(
  model: ExportModel,
  row: ExportArtifactRow,
  opts: RenderOptions,
  scheduleSlot: ScheduleSlot | null,
): Promise<Uint8Array> {
  switch (row.exportType) {
    case 'CATEGORY_DRAW':
      return renderCategoryDrawPdf(model, row.categoryId ?? '', opts);
    case 'POOL_SHEET':
      return renderPoolSheetPdf(model, row.poolId ?? '', opts);
    case 'BRACKET_SHEET':
      return renderBracketSheetPdf(model, row.poolId ?? '', opts);
    case 'TOURNAMENT_DRAW_BOOK':
      return renderTournamentDrawBookPdf(model, opts);
    case 'XLSX_WORKBOOK':
      return buildExportWorkbook(model, opts);
    case 'SEMI_PRESTASI_COMPACT_DRAW_SHEET': {
      if (row.scopeType === 'CATEGORY') {
        return renderSemiPrestasiCompactDrawSheetPdf(model, opts, row.categoryId ?? '');
      }
      // REVISION scope: when this draw run was generated for one arena/day "Jadwal FIX" slot (the
      // normal "Lihat Bagan" flow), render the committee's own DAY/ARENA session sheet -- one
      // continuous document for everything scheduled there, matching what the team already
      // approved (artifacts/review/final-bracket/OFFICIAL_final.pdf) -- instead of the generic
      // "every semi-prestasi category in this revision" compact sheet, which has no session
      // heading and was never meant to stand in for it. A draw not tied to any schedule slot (made
      // outside that flow) falls back to the compact sheet, since there is no slot to name.
      return scheduleSlot
        ? renderSemiPrestasiSessionDrawSheetPdf(model, opts, scheduleSlot)
        : renderSemiPrestasiCompactDrawSheetPdf(model, opts, null);
    }
    /* c8 ignore next 2 -- exhaustive over the ExportRowType union */
    default:
      throw new Error(`unknown export type: ${String(row.exportType)}`);
  }
}

/**
 * Claims one REQUESTED export and runs it through to READY or FAILED (Phase 6 ACCEPTANCE §11).
 * Mirrors `executeDrawRun`'s shape exactly: `claimExport`'s atomic CAS is the single source of
 * truth for "who generates it, exactly once" — this function is safe to call from both the
 * pg-boss job handler and the reconciliation sweep, and a call that loses the claim race is a
 * silent no-op (`claimed: false`).
 */
export async function executeExport(
  db: Db,
  storage: ArtifactStorage,
  exportId: string,
): Promise<{ claimed: boolean }> {
  const claimed = await claimExport(db, exportId);
  if (!claimed) return { claimed: false };

  try {
    const model = await loadExportModel(db, claimed.revisionId);
    const scope = resolveScope(model, claimed);
    const semanticFingerprint = computeSemanticExportFingerprint(scope.fingerprintSubject);
    const generatedAt = new Date().toISOString();
    const verificationCode = semanticFingerprint.replace('sha256:', '').slice(0, 12);
    // The rendered document is always the clean "official" layout (no PREVIEW watermark, no
    // TB/BB/Sabuk) regardless of `claimed.mode` -- the editable Cek & Atur Bagan screen already IS
    // the team's preview, so there is no reason a printed document should ever look different from
    // the final one. `claimed.mode` itself is untouched: it still gates WHO may request an export
    // and WHEN (see canExportInMode, packages/domain/src/export-policy.ts) and is still the value
    // stored on the export_artifact row and shown in the export history.
    const opts: RenderOptions = { mode: 'OFFICIAL', generatedAt, verificationCode };

    // Resolved once here (not inside renderBytes) so both the rendering AND the filename reflect
    // the same arena/day slot -- a REVISION-scope semi-prestasi sheet generated from a schedule-
    // driven draw run should be named "DAY 1 · ARENA A", not the generic document-type name, same
    // as its own printed header.
    const scheduleSlot =
      claimed.exportType === 'SEMI_PRESTASI_COMPACT_DRAW_SHEET' && claimed.scopeType !== 'CATEGORY'
        ? await loadScheduleSlotForDrawRun(db, claimed.tournamentId, claimed.drawRunId)
        : null;

    const bytes = await renderBytes(model, claimed, opts, scheduleSlot);
    const fileSha256 = computeFileSha256(bytes);
    const slotSlug = scheduleSlot ? `day${scheduleSlot.dayNumber}-${scheduleSlot.arena}` : null;
    const filename = exportFilename({
      tournamentSlug: model.tournament.code,
      documentType: claimed.exportType,
      revisionNo: claimed.revisionNo,
      ...(scope.category ? { categorySlug: scope.category.categoryKey } : slotSlug ? { categorySlug: slotSlug } : {}),
      generatedAt,
      extension: claimed.format === 'PDF' ? 'pdf' : 'xlsx',
    });
    const storageKey = `exports/${claimed.tournamentId}/${claimed.id}/${filename}`;
    await storage.write(storageKey, bytes);

    await completeExport(db, claimed.id, {
      storageKey,
      filename,
      sizeBytes: bytes.byteLength,
      outputFingerprint: semanticFingerprint,
      fileSha256,
    });
    return { claimed: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code = message.includes('not found') ? 'EXPORT_SOURCE_NOT_FOUND' : 'EXPORT_GENERATION_FAILED';
    await failExport(db, claimed.id, code, message);
    return { claimed: true };
  }
}

export function registerExportWorker(
  boss: PgBoss,
  db: Db,
  storage: ArtifactStorage,
  log: Pick<Console, 'log' | 'error'> = console,
): Promise<string> {
  return boss.work<{ exportId: string }>(
    EXPORT_QUEUE,
    { batchSize: 1 },
    async (jobs: Job<{ exportId: string }>[]) => {
      const job = jobs[0];
      if (!job) return;
      const { exportId } = job.data;
      const result = await executeExport(db, storage, exportId);
      log.log(`export ${exportId}: ${result.claimed ? 'processed' : 'already claimed, skipped'}`);
    },
  );
}
