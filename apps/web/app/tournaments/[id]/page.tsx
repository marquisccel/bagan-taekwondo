'use client';

import { useParams } from 'next/navigation';
import { useApiSWR } from '../../../lib/use-api-swr';

import { ExportPanel } from '../../../components/ExportPanel';
import { api } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import {
  drawRunKindLabel,
  drawRunStatusLabel,
  formatDateRange,
  revisionLifecycleLabel,
  ruleSetStatusLabel,
} from '../../../lib/id-labels';

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

  if (isLoading) return <main className="content state-loading">Memuat turnamen…</main>;
  if (error) return <main className="content state-error">Gagal memuat: {error.message}</main>;
  if (!data) return <main className="content state-empty">Tidak ada data.</main>;

  const run = data.latestDrawRun;
  const rev = data.latestRevision;

  return (
    <main className="content page-stack">
      <div className="page-header">
        <h1>{data.name}</h1>
        <span className="page-header-meta">{formatDateRange(data.eventStart, data.eventEnd)}</span>
      </div>

      {data.activeRuleSetStatus !== 'ACTIVE' ? (
        <div className="banner banner-info">
          Set aturan berstatus {ruleSetStatusLabel(data.activeRuleSetStatus)}, belum Aktif. Drawing belum bisa
          dikunci sampai set aturan aktif.
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="value">{data.totalEntries}</div>
          <div className="label">Total Peserta</div>
        </div>
        <div className="stat">
          <div className="value">{data.totalContingents}</div>
          <div className="label">Kontingen</div>
        </div>
        <div className="stat">
          <div className="value">{run ? drawRunStatusLabel(run.status) : 'Belum ada'}</div>
          <div className="label">Status Drawing</div>
        </div>
        <div className="stat">
          <div className="value">{rev ? revisionLifecycleLabel(rev.lifecycle) : '·'}</div>
          <div className="label">Status Revisi</div>
        </div>
        <div className="stat">
          <div className="value">
            {data.categoryCounts.ready} / {data.categoryCounts.total}
          </div>
          <div className="label">Kategori Siap</div>
        </div>
        <div className="stat">
          <div
            className="value"
            style={{ color: data.categoryCounts.blocked > 0 ? 'var(--red)' : undefined }}
          >
            {data.categoryCounts.blocked}
          </div>
          <div className="label">Kategori Diblokir</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: data.errorCount > 0 ? 'var(--red)' : undefined }}>
            {data.errorCount}
          </div>
          <div className="label">Error</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: data.warningCount > 0 ? 'var(--yellow)' : undefined }}>
            {data.warningCount}
          </div>
          <div className="label">Peringatan</div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Bagan Terakhir</h3>
        {run ? (
          <>
            <p style={{ margin: '0 0 12px' }}>
              <strong>{drawRunKindLabel(run.kind)}</strong> · {drawRunStatusLabel(run.status)} · diminta{' '}
              {new Date(run.requestedAt).toLocaleString('id-ID')}
            </p>
            {rev ? (
              <a className="btn btn-primary" href={`/tournaments/${id}/sesi/${rev.id}`}>
                Cek &amp; Atur Bagan
              </a>
            ) : (
              <p className="state-empty" style={{ margin: 0 }}>
                Bagan sedang diproses, belum ada revisi untuk diperiksa.
              </p>
            )}
          </>
        ) : (
          <p className="state-empty" style={{ margin: 0 }}>
            Belum ada bagan untuk turnamen ini. Buat jadwal terlebih dahulu di tab{' '}
            <a href={`/tournaments/${id}/jadwal`}>Jadwal &amp; Buat Bagan</a>.
          </p>
        )}
      </div>

      {rev ? (
        <ExportPanel
          revisionId={rev.id}
          revisionLifecycle={rev.lifecycle}
          availableTypes={['TOURNAMENT_DRAW_BOOK', 'XLSX_WORKBOOK', 'SEMI_PRESTASI_COMPACT_DRAW_SHEET']}
        />
      ) : null}
    </main>
  );
}
