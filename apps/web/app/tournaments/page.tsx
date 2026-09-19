'use client';

import { api } from '../../lib/api';
import { useDevAuth } from '../../lib/dev-auth';
import {
  drawRunStatusLabel,
  formatDateRange,
  revisionLifecycleLabel,
  ruleSetStatusLabel,
  tournamentStatusLabel,
} from '../../lib/id-labels';
import { useApiSWR } from '../../lib/use-api-swr';

/** AUD-008: the tournaments the current (dev) actor is a member of. Selecting one opens its overview. */
export default function TournamentListPage() {
  const { actorId } = useDevAuth();
  const { data, error, isLoading } = useApiSWR(actorId ? ['tournaments', actorId] : null, () =>
    api.tournaments(actorId),
  );

  if (!actorId) {
    return (
      <main className="content state-empty">
        <p>Belum terhubung. Masukkan ID pengguna Anda terlebih dahulu.</p>
        <a className="btn btn-primary" href="/">
          Hubungkan
        </a>
      </main>
    );
  }
  if (isLoading) return <main className="content state-loading">Memuat daftar turnamen…</main>;
  if (error)
    return <main className="content state-error">Gagal memuat daftar turnamen: {error.message}</main>;
  if (!data || data.length === 0)
    return (
      <main className="content">
        <h1>Turnamen</h1>
        <div className="panel state-empty" data-testid="tournament-list-empty">
          Belum ada turnamen yang dapat Anda akses.
        </div>
      </main>
    );

  return (
    <main className="content">
      <h1>Turnamen</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Pilih turnamen untuk membuka ringkasan, peserta, dan drawing.
      </p>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table aria-label="Daftar turnamen">
          <thead>
            <tr>
              <th>Turnamen</th>
              <th>Kode</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th>Set aturan</th>
              <th>Drawing terakhir</th>
              <th>Revisi</th>
              <th>Kategori siap</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id} data-testid="tournament-row">
                <td>
                  <a href={`/tournaments/${t.id}`} style={{ fontWeight: 600 }}>
                    {t.name}
                  </a>
                </td>
                <td>
                  <code>{t.code}</code>
                </td>
                <td>{formatDateRange(t.eventStart, t.eventEnd)}</td>
                <td>{tournamentStatusLabel(t.status)}</td>
                <td>{ruleSetStatusLabel(t.activeRuleSetStatus)}</td>
                <td>
                  {t.latestDrawRun ? (
                    <>
                      {drawRunStatusLabel(t.latestDrawRun.status)}{' '}
                      <span style={{ color: 'var(--text-dim)' }}>
                        ({new Date(t.latestDrawRun.requestedAt).toLocaleString('id-ID')})
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Belum ada</span>
                  )}
                </td>
                <td>
                  {t.latestRevision ? (
                    <>
                      #{t.latestRevision.revision_no} · {revisionLifecycleLabel(t.latestRevision.lifecycle)}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>—</span>
                  )}
                </td>
                <td>
                  {t.categoryCounts.total > 0 ? (
                    <>
                      {t.categoryCounts.ready} / {t.categoryCounts.total}
                      {t.categoryCounts.blocked > 0 ? (
                        <span style={{ color: 'var(--red)' }}> · {t.categoryCounts.blocked} diblokir</span>
                      ) : null}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>—</span>
                  )}
                </td>
                <td>
                  <a className="btn" href={`/tournaments/${t.id}`} aria-label={`Buka ${t.name}`}>
                    Buka
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
