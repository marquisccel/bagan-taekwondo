'use client';

import { useParams } from 'next/navigation';
import { useApiSWR } from '../../../lib/use-api-swr';

import { ExportPanel } from '../../../components/ExportPanel';
import { api, type TournamentSummary } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import { formatDateRange, revisionLifecycleLabel, ruleSetStatusLabel } from '../../../lib/id-labels';

/** A plain sentence for the latest draw run -- no engine jargon ("Kandidat"/"Aman") in the headline;
 * a committee member cares whether the bracket is ready to use, not the engine's internal run kind. */
function drawRunSummary(
  run: NonNullable<TournamentSummary['latestDrawRun']>,
  rev: TournamentSummary['latestRevision'],
): string {
  const when = new Date(run.requestedAt).toLocaleString('id-ID');
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return `Bagan sedang dibuat sejak ${when}…`;
  if (run.status === 'FAILED') {
    return `Pembuatan bagan terakhir (${when}) gagal. Coba buat ulang dari Jadwal.`;
  }
  if (run.status === 'UNSAFE') return `Bagan dibuat ${when}, tapi ada yang perlu ditinjau sebelum dipakai.`;
  const statusWord = rev ? ` · Status: ${revisionLifecycleLabel(rev.lifecycle)}` : '';
  return `Bagan berhasil dibuat ${when}${statusWord}.`;
}

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
  // One general "needs attention" figure instead of three separate developer-facing counters
  // (blocked categories, errors, warnings) -- a committee member needs to know whether SOMETHING
  // needs a look, not the engine's own breakdown of why.
  const needsAttention = data.categoryCounts.blocked + data.errorCount + data.warningCount;
  const attentionColor =
    data.errorCount > 0 || data.categoryCounts.blocked > 0
      ? 'var(--red)'
      : data.warningCount > 0
        ? 'var(--yellow)'
        : undefined;

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
          <div className="value">
            {data.categoryCounts.ready} / {data.categoryCounts.total}
          </div>
          <div className="label">Kategori Siap</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: attentionColor }}>
            {needsAttention}
          </div>
          <div className="label">Perlu Ditinjau</div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Bagan Terakhir</h3>
        {run ? (
          <>
            <p style={{ margin: '0 0 12px' }}>{drawRunSummary(run, rev)}</p>
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
            <a href={`/tournaments/${id}/jadwal`}>Jadwal</a>.
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
