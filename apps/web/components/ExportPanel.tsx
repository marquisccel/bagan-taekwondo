'use client';

import { useState } from 'react';

import {
  api,
  ApiClientError,
  downloadExportFile,
  type ExportArtifact,
  type ExportMode,
  type ExportType,
} from '../lib/api';
import { friendlyExportMessage } from '../lib/command-error';
import { useDevAuth } from '../lib/dev-auth';
import { useApiSWR } from '../lib/use-api-swr';

const TYPE_LABEL: Record<ExportType, string> = {
  TOURNAMENT_DRAW_BOOK: 'Buku Bagan Turnamen (PDF)',
  CATEGORY_DRAW: 'Bagan Kategori (PDF)',
  POOL_SHEET: 'Lembar Pool (PDF)',
  BRACKET_SHEET: 'Bagan Pertandingan (PDF)',
  XLSX_WORKBOOK: 'Workbook (XLSX)',
};

const STATUS_LABEL: Record<ExportArtifact['status'], string> = {
  REQUESTED: 'Menunggu',
  GENERATING: 'Diproses',
  READY: 'Siap',
  FAILED: 'Gagal',
};

/**
 * Minimal Phase 6 export UI (ACCEPTANCE §14) — an "Ekspor" action, a type selector already scoped
 * to what's valid for this page (categoryId/poolId are fixed by the caller, never chosen loosely),
 * a Preview/Resmi indicator, generation status, download, and history. No redesign of Phase 5: this
 * is one more `panel` block using the same classes as LifecycleBar/RevisionConflictBanner.
 */
export function ExportPanel({
  revisionId,
  availableTypes,
  categoryId,
  poolId,
}: {
  revisionId: string;
  availableTypes: readonly ExportType[];
  categoryId?: string;
  poolId?: string;
}) {
  const { actorId, role } = useDevAuth();
  const [exportType, setExportType] = useState<ExportType>(availableTypes[0] ?? 'TOURNAMENT_DRAW_BOOK');
  const [mode, setMode] = useState<ExportMode>('PREVIEW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: history, mutate } = useApiSWR(
    actorId && revisionId ? ['exports', revisionId, actorId] : null,
    () => api.listExports(actorId, revisionId),
    {
      refreshInterval: (data) =>
        data?.some((e) => e.status === 'REQUESTED' || e.status === 'GENERATING') ? 2000 : 0,
    },
  );

  const relevant = (history ?? []).filter(
    (e) =>
      e.exportType === exportType && e.categoryId === (categoryId ?? null) && e.poolId === (poolId ?? null),
  );

  const requestExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestExport(actorId, revisionId, { exportType, mode, categoryId, poolId });
      await mutate();
    } catch (e: unknown) {
      const code = e instanceof ApiClientError ? e.code : 'UNKNOWN_ERROR';
      const message = e instanceof Error ? e.message : 'Permintaan gagal';
      setError(friendlyExportMessage(code, message));
    }
    setBusy(false);
  };

  const download = async (exp: ExportArtifact) => {
    setError(null);
    try {
      await downloadExportFile(actorId, exp);
    } catch (e: unknown) {
      const code = e instanceof ApiClientError ? e.code : 'UNKNOWN_ERROR';
      setError(friendlyExportMessage(code, 'Unduhan gagal'));
    }
  };

  if (role === null) return null;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Ekspor</h3>
      {error ? (
        <div className="banner banner-conflict" role="alert">
          <span>{error}</span>
          <button className="btn" onClick={() => setError(null)}>
            Tutup
          </button>
        </div>
      ) : null}
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
        <select
          aria-label="Status resmi"
          value={mode}
          onChange={(e) => setMode(e.target.value as ExportMode)}
        >
          <option value="PREVIEW">Preview</option>
          <option value="OFFICIAL">Resmi</option>
        </select>
        <button className="btn btn-primary" disabled={busy} onClick={() => void requestExport()}>
          Buat Ekspor
        </button>
      </div>

      {relevant.length > 0 ? (
        <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Mode</th>
              <th style={{ textAlign: 'left' }}>Diminta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {relevant.map((e) => (
              <tr key={e.id}>
                <td>
                  <span
                    className={`badge ${e.status === 'FAILED' ? 'badge-red' : e.status === 'READY' ? 'badge-green' : 'badge-yellow'}`}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
                <td>{e.mode === 'PREVIEW' ? 'Preview' : 'Resmi'}</td>
                <td>{new Date(e.requestedAt).toLocaleString('id-ID')}</td>
                <td>
                  {e.status === 'READY' ? (
                    <button className="btn" onClick={() => void download(e)}>
                      Unduh
                    </button>
                  ) : e.status === 'FAILED' ? (
                    <span style={{ color: 'var(--text-dim)' }}>{e.errorCode}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
