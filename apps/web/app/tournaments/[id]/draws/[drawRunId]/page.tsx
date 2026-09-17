'use client';

import { useParams } from 'next/navigation';
import { useApiSWR } from '../../../../../lib/use-api-swr';

import { StatusBadge } from '../../../../../components/StatusBadge';
import { api } from '../../../../../lib/api';
import { useDevAuth } from '../../../../../lib/dev-auth';

export default function DrawRunPage() {
  const { id, drawRunId } = useParams<{ id: string; drawRunId: string }>();
  const { actorId } = useDevAuth();
  const {
    data: run,
    error,
    isLoading,
  } = useApiSWR(actorId ? ['draw-run', drawRunId, actorId] : null, () => api.drawRun(actorId, drawRunId));
  const { data: quality } = useApiSWR(
    actorId && run?.status === 'SAFE' ? ['draw-run-quality', drawRunId, actorId] : null,
    () => api.drawRunQuality(actorId, drawRunId),
  );

  if (isLoading) return <main className="content state-loading">Loading draw run…</main>;
  if (error) return <main className="content state-error">Failed to load: {error.message}</main>;
  if (!run) return <main className="content state-empty">Draw run not found.</main>;

  const blocked = run.status === 'UNSAFE' || run.status === 'FAILED';

  return (
    <main className="content">
      <h1>Draw run</h1>
      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="value">
            <StatusBadge
              quality={run.status === 'SAFE' ? 'GREEN' : blocked ? 'RED' : 'YELLOW'}
              title={run.status}
            />
          </div>
          <div className="label">Status</div>
        </div>
        <div className="stat">
          <div className="value">{run.kind}</div>
          <div className="label">Kind</div>
        </div>
        <div className="stat">
          <div className="value">
            {run.dual_run_match === null ? '—' : run.dual_run_match ? 'Match' : 'MISMATCH'}
          </div>
          <div className="label">Dual-run check</div>
        </div>
        <div className="stat">
          <div className="value">
            {run.duration_ms !== null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
          </div>
          <div className="label">Duration</div>
        </div>
      </div>

      {blocked ? (
        <div className="banner banner-conflict">
          This draw run is {run.status.toLowerCase()}. It cannot be simulated further; a new draw run is
          required.
        </div>
      ) : null}

      <div className="panel grid" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Fingerprints</h3>
        <div>
          rules: <code>{run.rules_fingerprint}</code>
        </div>
        <div>
          input: <code>{run.input_fingerprint}</code>
        </div>
        <div>
          output: <code>{run.output_fingerprint ?? '—'}</code>
        </div>
        <div>engine: {run.engine_version}</div>
        <div>seed: {run.seed}</div>
      </div>

      {run.unsafe_reasons.length > 0 ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, color: 'var(--red)' }}>Unsafe reasons</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {JSON.stringify(run.unsafe_reasons, null, 2)}
          </pre>
        </div>
      ) : null}

      {quality ? (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Quality report</h3>
          <div className="stat-row">
            <div className="stat">
              <div className="value" style={{ color: quality.error_count > 0 ? 'var(--red)' : undefined }}>
                {quality.error_count}
              </div>
              <div className="label">Errors</div>
            </div>
            <div className="stat">
              <div
                className="value"
                style={{ color: quality.warning_count > 0 ? 'var(--yellow)' : undefined }}
              >
                {quality.warning_count}
              </div>
              <div className="label">Warnings</div>
            </div>
            <div className="stat">
              <div className="value">{quality.info_count}</div>
              <div className="label">Info</div>
            </div>
          </div>
        </div>
      ) : null}

      {run.status === 'SAFE' ? (
        <p style={{ marginTop: 16 }}>
          <a className="btn btn-primary" href={`/tournaments/${id}/categories`}>
            Browse categories
          </a>
        </p>
      ) : null}
    </main>
  );
}
