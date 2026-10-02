'use client';

import { useEffect, useState } from 'react';

import { api, ApiClientError, downloadExportFile, type ExportMode, type ExportType } from '../lib/api';
import { friendlyExportMessage } from '../lib/command-error';
import { useDevAuth } from '../lib/dev-auth';
import { canExportOfficial } from '../lib/lifecycle';

const TYPE_LABEL: Record<ExportType, string> = {
  TOURNAMENT_DRAW_BOOK: 'Buku Bagan Lengkap · Semua Kategori (PDF)',
  CATEGORY_DRAW: 'Bagan Kategori (PDF)',
  POOL_SHEET: 'Lembar Pool (PDF)',
  BRACKET_SHEET: 'Bagan Pertandingan (PDF)',
  XLSX_WORKBOOK: 'Workbook (XLSX)',
  SEMI_PRESTASI_COMPACT_DRAW_SHEET: 'Lembar Bagan Arena/Hari Ini (PDF)',
};

/**
 * Minimal Phase 6 export UI (ACCEPTANCE §14) — an "Ekspor" action and a type selector already
 * scoped to what's valid for this page (categoryId/poolId are fixed by the caller, never chosen
 * loosely). "Buat Ekspor" goes straight to a saved file: no visible history list and no separate
 * "Unduh" click -- the team just wants the file, so this polls the one export it just requested
 * until it's READY and downloads it immediately.
 */
export function ExportPanel({
  revisionId,
  revisionLifecycle,
  availableTypes,
  categoryId,
  poolId,
  bare,
  slotLabel,
}: {
  revisionId: string;
  /** Picks the export mode automatically -- see the `mode` comment below. */
  revisionLifecycle: string;
  availableTypes: readonly ExportType[];
  categoryId?: string;
  poolId?: string;
  /** Renders just the type selector + "Buat Ekspor" row, no wrapping panel/heading of its own --
   * for embedding inside another card (the dashboard's greeting card) that already provides both. */
  bare?: boolean;
  /** Replaces the plain "Ekspor" heading with the arena/day slot the session view is scoped to
   * (e.g. "DAY 1 · Arena C") -- so it's visible right next to the controls that export exactly that
   * slot, not just inferred from the page the team happened to click through to get here. */
  slotLabel?: string;
}) {
  const { actorId, role } = useDevAuth();
  const [exportType, setExportType] = useState<ExportType>(availableTypes[0] ?? 'TOURNAMENT_DRAW_BOOK');
  // No Preview/Resmi CHOICE here: the editable "Cek & Atur Bagan" screen (with TB/BB/Sabuk visible)
  // already IS the preview, and every rendered document -- PREVIEW or OFFICIAL -- now uses the same
  // clean "official" layout (see export-worker.ts), so the team never sees a visual difference.
  // `mode` itself still has to be picked correctly, though: the backend only allows an OFFICIAL
  // export once the revision is LOCKED+ (canExportInMode), so requesting OFFICIAL from a DRAFT
  // revision -- exactly when the team is using this panel from Cek & Atur Bagan -- would always be
  // refused. PREVIEW is used until the revision reaches that point, entirely transparently.
  const mode: ExportMode = canExportOfficial(revisionLifecycle) ? 'OFFICIAL' : 'PREVIEW';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Poll the one export just requested until it's READY (download it immediately, no separate
  // click) or FAILED (show why). Never touches any other export's history.
  useEffect(() => {
    if (!pendingId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const exp = await api.getExport(actorId, pendingId);
        if (cancelled) return;
        if (exp.status === 'READY') {
          setPendingId(null);
          setBusy(false);
          await downloadExportFile(actorId, exp);
        } else if (exp.status === 'FAILED') {
          setPendingId(null);
          setBusy(false);
          setError(friendlyExportMessage(exp.errorCode ?? 'EXPORT_GENERATION_FAILED', 'Ekspor gagal'));
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setPendingId(null);
        setBusy(false);
        const code = e instanceof ApiClientError ? e.code : 'UNKNOWN_ERROR';
        setError(friendlyExportMessage(code, 'Gagal memeriksa status ekspor'));
      }
    };
    const interval = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingId, actorId]);

  const requestExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.requestExport(actorId, revisionId, { exportType, mode, categoryId, poolId });
      setPendingId(created.id);
    } catch (e: unknown) {
      const code = e instanceof ApiClientError ? e.code : 'UNKNOWN_ERROR';
      const message = e instanceof Error ? e.message : 'Permintaan gagal';
      setError(friendlyExportMessage(code, message));
      setBusy(false);
    }
  };

  if (role === null) return null;

  const controls = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        aria-label="Jenis ekspor"
        value={exportType}
        onChange={(e) => setExportType(e.target.value as ExportType)}
      >
        {availableTypes.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <button className="btn btn-primary" disabled={busy} onClick={() => void requestExport()}>
        {busy ? 'Memproses…' : 'Buat Ekspor'}
      </button>
    </div>
  );

  const errorBanner = error ? (
    <div className="banner banner-conflict" role="alert">
      <span>{error}</span>
      <button className="btn" onClick={() => setError(null)}>
        Tutup
      </button>
    </div>
  ) : null;

  if (bare)
    return (
      <>
        {errorBanner}
        {controls}
      </>
    );

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        {slotLabel ? (
          <h2 style={{ margin: 0, fontSize: 22 }}>{slotLabel}</h2>
        ) : (
          <h3 style={{ margin: 0 }}>Ekspor</h3>
        )}
        {controls}
      </div>
      {errorBanner}
    </div>
  );
}
