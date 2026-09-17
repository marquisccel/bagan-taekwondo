'use client';

import type { EntryDisplay } from '../lib/api';

export function EntryDrawer({
  entry,
  categoryMovement,
  onClose,
}: {
  entry: EntryDisplay;
  categoryMovement: string | null;
  onClose: () => void;
}) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`Details for ${entry.displayName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="btn" onClick={onClose} style={{ float: 'right' }} aria-label="Close">
          Close
        </button>
        <h2 style={{ marginTop: 0 }}>{entry.displayName}</h2>
        <p>
          <strong>Contingent:</strong> {entry.contingent}
          <br />
          <strong>External ref:</strong> {entry.externalRef ?? '—'}
        </p>
        {categoryMovement ? (
          <p>
            <strong>Movement:</strong> {categoryMovement}
          </p>
        ) : null}
        <h3>Members</h3>
        {entry.athletes.map((a, i) => (
          <div key={i} className="panel" style={{ marginBottom: 8 }}>
            <div>
              <strong>{a.fullName ?? 'Name not registered'}</strong>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {a.gender ?? '—'} · {a.weightG !== null ? `${(a.weightG / 1000).toFixed(1)} kg` : 'weight —'} ·{' '}
              {a.heightMm !== null ? `${Math.round(a.heightMm / 10)} cm` : 'height —'} · belt{' '}
              {a.beltCode ?? '—'}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
