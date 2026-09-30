'use client';

import { useParams } from 'next/navigation';
import { useApiSWR } from '../../../lib/use-api-swr';

import { ExportPanel } from '../../../components/ExportPanel';
import { api, type TournamentSummary } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import { formatDateRange, ruleSetStatusLabel } from '../../../lib/id-labels';
import { useNow } from '../../../lib/use-now';

/** A plain sentence for the latest draw run -- no engine jargon ("Kandidat"/"Aman") in the headline;
 * a committee member cares whether the bracket is ready to use, not the engine's internal run kind.
 * Only shown for a run that ISN'T quietly successful: once a revision exists, "Cek & Atur Bagan" and
 * the stat cards above already say everything a plain "berhasil dibuat" sentence would repeat. */
function drawRunSummary(run: NonNullable<TournamentSummary['latestDrawRun']>): string | null {
  const when = new Date(run.requestedAt).toLocaleString('id-ID');
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return `Bagan sedang dibuat sejak ${when}…`;
  if (run.status === 'FAILED')
    return `Pembuatan bagan terakhir (${when}) gagal. Coba buat ulang dari Jadwal.`;
  if (run.status === 'UNSAFE') return `Bagan dibuat ${when}, tapi ada yang perlu ditinjau sebelum dipakai.`;
  return null;
}

function greetingForHour(hour: number): string {
  if (hour >= 4 && hour < 11) return 'Selamat pagi';
  if (hour >= 11 && hour < 15) return 'Selamat siang';
  if (hour >= 15 && hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/**
 * The dashboard's hero: replaces the old static "Admin" badge (a clock-aware greeting is a warmer
 * way to say the same thing -- the clock itself now lives in the topbar, shared by every tournament
 * page) and the standalone "Bagan Terakhir" panel -- its one actual action, "Cek & Atur Bagan",
 * belongs here as the page's primary call to action, next to Ekspor (also relocated here) rather
 * than in a panel of its own.
 */
function GreetingCard({
  id,
  run,
  rev,
}: {
  id: string;
  run: TournamentSummary['latestDrawRun'];
  rev: TournamentSummary['latestRevision'];
}) {
  const now = useNow();
  const runNote = run ? drawRunSummary(run) : null;

  return (
    <div className="panel greeting-card">
      <div className="greeting-info">
        <h2 className="greeting-text">{greetingForHour(now.getHours())}, Admin</h2>
        {!run ? (
          <p className="greeting-note">
            Belum ada bagan. Buat jadwal terlebih dahulu di tab{' '}
            <a href={`/tournaments/${id}/jadwal`}>Jadwal</a>.
          </p>
        ) : runNote ? (
          <p className="greeting-note">{runNote}</p>
        ) : null}
      </div>
      <div className="greeting-actions">
        {rev ? (
          <a className="btn btn-primary" href={`/tournaments/${id}/sesi/${rev.id}`}>
            Cek &amp; Atur Bagan
          </a>
        ) : null}
        {rev ? (
          <ExportPanel
            bare
            revisionId={rev.id}
            revisionLifecycle={rev.lifecycle}
            availableTypes={['TOURNAMENT_DRAW_BOOK', 'XLSX_WORKBOOK', 'SEMI_PRESTASI_COMPACT_DRAW_SHEET']}
          />
        ) : null}
      </div>
    </div>
  );
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

  return (
    <main className="content page-stack">
      <div className="page-header">
        <h1>
          {data.name}{' '}
          <span className="page-header-meta">({formatDateRange(data.eventStart, data.eventEnd)})</span>
        </h1>
      </div>

      {data.activeRuleSetStatus !== 'ACTIVE' ? (
        <div className="banner banner-info">
          Set aturan berstatus {ruleSetStatusLabel(data.activeRuleSetStatus)}, belum Aktif. Drawing belum bisa
          dikunci sampai set aturan aktif.
        </div>
      ) : null}

      <GreetingCard id={id} run={run} rev={rev} />

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
        <a className="stat stat-link" href={`/tournaments/${id}/peserta?review=NEEDS_REVIEW`}>
          <div
            className="value"
            style={{ color: data.participantsNeedingReview > 0 ? 'var(--yellow)' : undefined }}
          >
            {data.participantsNeedingReview}
          </div>
          <div className="label">Perlu Ditinjau</div>
          <div className="stat-link-hint">
            Lihat masalah
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14m0 0-6-6m6 6-6 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </a>
      </div>
    </main>
  );
}
