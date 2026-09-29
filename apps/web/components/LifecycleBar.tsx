'use client';

import { useState } from 'react';

import { api, type CommandOutcome } from '../lib/api';
import { friendlyMessage, runCommand } from '../lib/command-error';
import { useDevAuth } from '../lib/dev-auth';
import { revisionLifecycleLabel, roleLabel } from '../lib/id-labels';
import { LIFECYCLE_STEPS, canAttempt, nextLifecycleAction } from '../lib/lifecycle';

function runAction(
  action: 'submit-review' | 'approve' | 'lock' | 'publish' | 'amend',
  actorId: string,
  revisionId: string,
  lockVersion: number,
): Promise<CommandOutcome> {
  if (action === 'submit-review') return api.submitReview(actorId, revisionId, lockVersion);
  if (action === 'approve') return api.approve(actorId, revisionId, lockVersion);
  if (action === 'lock') return api.lock(actorId, revisionId, lockVersion);
  if (action === 'publish') return api.publish(actorId, revisionId, lockVersion);
  throw new Error('amend requires a reason; use api.amend directly');
}

export function LifecycleBar({
  lifecycle,
  lockVersion,
  revisionId,
  onChanged,
  onConflict,
}: {
  lifecycle: string;
  lockVersion: number;
  revisionId: string;
  onChanged: (outcome: CommandOutcome) => void;
  onConflict: () => void;
}) {
  const { actorId, role } = useDevAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amendReason, setAmendReason] = useState('');
  const next = nextLifecycleAction(lifecycle);

  const run = async (fn: () => Promise<CommandOutcome>) => {
    setBusy(true);
    setError(null);
    const result = await runCommand(fn);
    if (result.ok) {
      onChanged(result.outcome);
    } else if (result.code === 'REVISION_CONFLICT') {
      onConflict();
    } else {
      setError(friendlyMessage(result.code, result.message));
    }
    setBusy(false);
  };

  return (
    <div className="panel lifecycle-control">
      <div className="lifecycle-bar">
        {LIFECYCLE_STEPS.map((step) => (
          <span key={step} className={`lifecycle-step${step === lifecycle ? ' current' : ''}`}>
            {revisionLifecycleLabel(step)}
          </span>
        ))}
      </div>
      {error ? (
        <div className="banner banner-conflict" role="alert">
          <span>{error}</span>
          <button className="btn" onClick={() => setError(null)}>
            Tutup
          </button>
        </div>
      ) : null}
      {next ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {next.action === 'amend' ? (
            <>
              <input
                aria-label="Alasan revisi"
                placeholder="Alasan membuat revisi baru"
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !canAttempt(role, next) || amendReason.trim().length === 0}
                onClick={() => run(() => api.amend(actorId, revisionId, lockVersion, amendReason.trim()))}
              >
                {next.label}
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy || !canAttempt(role, next)}
              onClick={() => run(() => runAction(next.action, actorId, revisionId, lockVersion))}
            >
              {next.label}
            </button>
          )}
          {!canAttempt(role, next) ? (
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              Minimal peran: {roleLabel(next.minRole)}
            </span>
          ) : null}
        </div>
      ) : (
        <span style={{ color: 'var(--text-dim)' }}>
          {lifecycle === 'AMENDED'
            ? 'Sedang direvisi. Ada revisi baru berstatus Draf.'
            : 'Tidak ada tindakan lebih lanjut pada status ini.'}
        </span>
      )}
    </div>
  );
}
