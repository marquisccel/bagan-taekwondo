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
        aria-label={`Move ${entryName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Move {entryName}</h2>
        <p style={{ color: 'var(--text-dim)' }}>Choose a destination pool.</p>
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
                {p.poolUid} {p.id === currentPoolId ? '(current)' : `— ${p.members.length} entries`}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
