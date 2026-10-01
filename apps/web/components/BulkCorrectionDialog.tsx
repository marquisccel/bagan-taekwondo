'use client';

import { useState } from 'react';

import { api, type EntryListItem } from '../lib/api';
import { useApiSWR } from '../lib/use-api-swr';
import { EntryCorrectionDialog } from './EntryCorrectionDialog';

const MAX_PER_RUN = 200;

/**
 * The mitigation for "the team has to fix the sheet and re-upload the SPS" (ACCEPTANCE feedback):
 * steps through every entry Peserta's own `?review=NEEDS_REVIEW` filter would show, one at a time,
 * reusing EntryCorrectionDialog's exact save logic (no second, divergent save path). "Simpan &
 * Lanjut" moves on automatically; "Lewati" skips without saving; "Tutup" exits the walkthrough at
 * any point -- whatever was already saved stays saved, nothing is rolled back.
 */
export function BulkCorrectionDialog({
  tournamentId,
  actorId,
  onClose,
  onProgress,
}: {
  tournamentId: string;
  actorId: string;
  onClose: () => void;
  /** Called after every save/skip so the caller's own list (and its "Perlu Ditinjau" count) stays current. */
  onProgress: () => void;
}) {
  const { data, error, isLoading, mutate } = useApiSWR(['bulk-correction', tournamentId, actorId], () =>
    api.entries(actorId, tournamentId, { hasIssues: true, limit: MAX_PER_RUN }),
  );
  const [index, setIndex] = useState(0);
  const [fixedCount, setFixedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  const advance = () => {
    onProgress();
    setIndex((i) => i + 1);
  };

  if (isLoading || !data) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <aside className="drawer inspector" role="dialog" aria-label="Perbaiki Semua Masalah Data">
          <p>Memuat daftar peserta yang perlu ditinjau…</p>
        </aside>
      </div>
    );
  }
  if (error) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <aside className="drawer inspector" role="dialog" aria-label="Perbaiki Semua Masalah Data">
          <p style={{ color: 'var(--red)' }}>Gagal memuat daftar peserta: {error.message}</p>
          <button type="button" className="btn" onClick={onClose}>
            Tutup
          </button>
        </aside>
      </div>
    );
  }

  const items = data.items;
  const total = data.total;
  const current: EntryListItem | undefined = items[index];

  if (!current) {
    const done = fixedCount + skippedCount;
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <aside
          className="drawer inspector"
          role="dialog"
          aria-label="Perbaiki Semua Masalah Data"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="inspector-header">
            <h2 className="inspector-title" style={{ marginBottom: 0 }}>
              Selesai
            </h2>
            <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Tutup">
              Tutup
            </button>
          </div>
          <p>
            {fixedCount} dari {done} peserta diperbaiki
            {skippedCount > 0 ? `, ${skippedCount} dilewati` : ''}.
          </p>
          {total > items.length ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              Ada {total - items.length} peserta bermasalah lain yang belum sempat ditampilkan (batas{' '}
              {MAX_PER_RUN} per sesi) -- buka "Perbaiki Semua" lagi untuk melanjutkan sisanya.
            </p>
          ) : null}
          <div className="inspector-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Tutup
            </button>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <EntryCorrectionDialog
      key={current.entryId}
      entry={current}
      tournamentId={tournamentId}
      actorId={actorId}
      onClose={onClose}
      subtitle={`Peserta ${index + 1} dari ${items.length} yang perlu ditinjau${total > items.length ? ` (dari ${total} total)` : ''}`}
      onSaved={() => {
        setFixedCount((n) => n + 1);
        void mutate();
        advance();
      }}
      extraActions={
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSkippedCount((n) => n + 1);
            advance();
          }}
        >
          Lewati
        </button>
      }
    />
  );
}
