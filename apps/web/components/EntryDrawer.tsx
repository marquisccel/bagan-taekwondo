'use client';

import type { EntryDisplay } from '../lib/api';
import { disciplineLabel, genderLabel, humanizeCode, streamLabel } from '../lib/id-labels';

/**
 * Contextual participant inspector (UX slice 0, §19) — closed unless a participant is selected;
 * shows only fields the domain actually provides on `EntryDisplay`/`CategoryDetail`. No corner
 * assignment, match number, weigh-in or tolerance result is invented here — those are not part of
 * the current data model, so they are simply absent, not faked.
 */
export function EntryDrawer({
  entry,
  category,
  poolOrdinal,
  editable,
  onClose,
  onMove,
  onSwap,
}: {
  entry: EntryDisplay;
  category: { discipline: string; stream: string; gender: string; movement: string | null };
  poolOrdinal: number | null;
  editable: boolean;
  onClose: () => void;
  onMove?: () => void;
  onSwap?: () => void;
}) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer inspector"
        role="dialog"
        aria-label={`Detail Peserta: ${entry.displayName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="btn btn-quiet inspector-close" onClick={onClose} aria-label="Tutup">
          Tutup
        </button>
        <h2 className="inspector-title">{entry.displayName}</h2>
        <div className="meta">{entry.contingent}</div>

        <section className="inspector-section">
          <h3>Pertandingan</h3>
          <dl className="inspector-dl">
            <dt>Disiplin</dt>
            <dd>{disciplineLabel(category.discipline)}</dd>
            <dt>Jenjang</dt>
            <dd>{streamLabel(category.stream)}</dd>
            <dt>Jenis Kelamin</dt>
            <dd>{genderLabel(category.gender)}</dd>
            {category.movement ? (
              <>
                <dt>Gerakan</dt>
                <dd>{humanizeCode(category.movement)}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="inspector-section">
          <h3>Data Peserta</h3>
          {entry.athletes.map((a, i) => (
            <dl className="inspector-dl" key={i}>
              <dt>Nama</dt>
              <dd>{a.fullName ?? 'Nama belum terdaftar'}</dd>
              <dt>Sabuk</dt>
              <dd>{a.beltLabel ?? (a.beltCode ? humanizeCode(a.beltCode) : '·')}</dd>
              <dt>Tinggi</dt>
              <dd className="num">{a.heightMm !== null ? `${Math.round(a.heightMm / 10)} cm` : '·'}</dd>
              <dt>Berat</dt>
              <dd className="num">{a.weightG !== null ? `${(a.weightG / 1000).toFixed(1)} kg` : '·'}</dd>
            </dl>
          ))}
        </section>

        <section className="inspector-section">
          <h3>Posisi Saat Ini</h3>
          <dl className="inspector-dl">
            <dt>Pool</dt>
            <dd>{poolOrdinal !== null ? `Pool ${poolOrdinal}` : '·'}</dd>
          </dl>
        </section>

        {editable && (onMove || onSwap) ? (
          <div className="inspector-actions">
            {onMove ? (
              <button type="button" className="btn btn-primary" onClick={onMove}>
                Pindahkan
              </button>
            ) : null}
            {onSwap ? (
              <button type="button" className="btn" onClick={onSwap}>
                Tukar Peserta
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
