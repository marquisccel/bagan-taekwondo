'use client';

import { useState } from 'react';

import type { CommandVerdict } from '../lib/api';
import { IMPACT_CHANGE_LABEL, impactCodeLabel, verdictCodes } from '../lib/impact-labels';

/**
 * Shows the server's verdict of the last applied MoveEntry / SwapEntries. GREEN is a quiet
 * confirmation; YELLOW lists exactly what got worse. The client never judges quality itself.
 */
export function CommandFeedback({ verdict, onDismiss }: { verdict: CommandVerdict; onDismiss: () => void }) {
  const codes = verdictCodes(verdict);
  const yellow = verdict.level === 'YELLOW';
  return (
    <div
      className={yellow ? 'banner banner-conflict' : 'banner banner-info'}
      role={yellow ? 'alert' : 'status'}
      data-testid="command-feedback"
      data-level={verdict.level}
    >
      <div>
        <strong>
          {yellow ? 'Perubahan diterapkan dengan peringatan kualitas.' : 'Perubahan diterapkan.'}
        </strong>
        {verdict.impact ? <div>{IMPACT_CHANGE_LABEL[verdict.impact.change]}</div> : null}
        {codes.length > 0 ? (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {codes.map((c) => (
              <li key={c} data-code={c}>
                {impactCodeLabel(c)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button className="btn" onClick={onDismiss}>
        Tutup
      </button>
    </div>
  );
}

/**
 * A valid change that lowers grouping quality needs a stated reason (ADR-0004). The reasons shown
 * here are the server's own; confirming re-sends the same command with the reason.
 */
export function ReasonPrompt({
  verdict,
  busy = false,
  onConfirm,
  onCancel,
}: {
  verdict: CommandVerdict;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const codes = verdictCodes(verdict);
  const valid = reason.trim().length > 0;
  return (
    <div className="drawer-overlay" onClick={onCancel}>
      <div
        className="drawer"
        role="dialog"
        aria-label="Alasan perubahan"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Perubahan menurunkan kualitas</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Perubahan ini sah, tetapi menurunkan kualitas pengelompokan. Isi alasan (misalnya nomor komplain)
          agar tercatat pada riwayat audit.
        </p>
        <ul>
          {codes.map((c) => (
            <li key={c} data-code={c}>
              {impactCodeLabel(c)}
            </li>
          ))}
        </ul>
        <label htmlFor="alasan-perubahan" style={{ display: 'block', marginBottom: 4 }}>
          Alasan
        </label>
        <textarea
          id="alasan-perubahan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            Terapkan
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
