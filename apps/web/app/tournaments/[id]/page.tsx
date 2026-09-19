'use client';

import { useParams } from 'next/navigation';
import { useApiSWR } from '../../../lib/use-api-swr';

import { ExportPanel } from '../../../components/ExportPanel';
import { api } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';

export default function TournamentOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { actorId } = useDevAuth();
  const { data, error, isLoading } = useApiSWR(
    actorId && id ? ['tournament', id, actorId] : null,
    () => api.tournament(actorId, id),
    {
      refreshInterval: 15_000,
    },
  );

  if (isLoading) return <main className="content state-loading">Loading tournament…</main>;
  if (error) return <main className="content state-error">Failed to load: {error.message}</main>;
  if (!data) return <main className="content state-empty">No data.</main>;

  const run = data.latestDrawRun;
  const rev = data.latestRevision;

  return (
    <main className="content">
      <h1>
        {data.name} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({data.code})</span>
      </h1>

      {data.activeRuleSetStatus !== 'ACTIVE' ? (
        <div className="banner banner-info">
          Rule set is {data.activeRuleSetStatus}, not ACTIVE — a draw cannot be locked until it is.
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="value">{run ? run.status : 'None'}</div>
          <div className="label">Draw run status</div>
        </div>
        <div className="stat">
          <div className="value">{rev ? rev.lifecycle : '—'}</div>
          <div className="label">Revision status</div>
        </div>
        <div className="stat">
          <div className="value">
            {data.categoryCounts.ready} / {data.categoryCounts.total}
          </div>
          <div className="label">Categories ready</div>
        </div>
        <div className="stat">
          <div
            className="value"
            style={{ color: data.categoryCounts.blocked > 0 ? 'var(--red)' : undefined }}
          >
            {data.categoryCounts.blocked}
          </div>
          <div className="label">Blocked categories</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: data.warningCount > 0 ? 'var(--yellow)' : undefined }}>
            {data.warningCount}
          </div>
          <div className="label">Warnings</div>
        </div>
      </div>

      <nav aria-label="Navigasi turnamen" className="panel" style={{ marginTop: 20 }}>
        <a className="btn" href={`/tournaments/${id}/peserta`}>
          Lihat peserta
        </a>{' '}
        <a className="btn btn-primary" href={`/tournaments/${id}/drawing`}>
          Buat Drawing
        </a>{' '}
        <a className="btn" href="/tournaments">
          Semua turnamen
        </a>
      </nav>

      <div style={{ marginTop: 20 }} className="grid">
        {run ? (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Current draw run</h3>
            <p>
              <strong>{run.kind}</strong> · {run.status} · requested{' '}
              {new Date(run.requestedAt).toLocaleString()}
            </p>
            <a className="btn" href={`/tournaments/${id}/draws/${run.id}`}>
              View draw run
            </a>{' '}
            {rev ? (
              <a className="btn btn-primary" href={`/tournaments/${id}/categories`}>
                Browse categories
              </a>
            ) : null}
          </div>
        ) : (
          <div className="panel state-empty">No draw run yet for this tournament.</div>
        )}
      </div>

      {rev ? (
        <ExportPanel
          revisionId={rev.id}
          availableTypes={['TOURNAMENT_DRAW_BOOK', 'XLSX_WORKBOOK', 'SEMI_PRESTASI_COMPACT_DRAW_SHEET']}
        />
      ) : null}
    </main>
  );
}
