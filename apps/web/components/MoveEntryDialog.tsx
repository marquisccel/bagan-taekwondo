'use client';

import type { PoolDetail } from '../lib/api';

/** Keyboard-accessible alternative to drag-and-drop for MoveEntry (ACCEPTANCE §ACCESSIBILITY). */
export function MoveEntryDialog({
  entryName,
  pools,
  currentPoolId,
  onPick,
  onCancel,
}: {
  entryName: string;
  pools: readonly PoolDetail[];
  currentPoolId: string;
  onPick: (poolUid: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="drawer-overlay" onClick={onCancel}>
      <div
        className="drawer"
        role="dialog"
        aria-label={`Pindahkan ${entryName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Pindahkan {entryName}</h2>
        <p style={{ color: 'var(--text-dim)' }}>Pilih pool tujuan.</p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {pools.map((p) => (
            <li key={p.id} style={{ marginBottom: 6 }}>
              <button
                type="button"
                className="btn"
                style={{ width: '100%', textAlign: 'left' }}
                disabled={p.id === currentPoolId}
                onClick={() => onPick(p.poolUid)}
              >
                Pool {p.ordinal} {p.id === currentPoolId ? '(saat ini)' : `· ${p.members.length} peserta`}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}
