'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BrandMark } from '../../components/BrandMark';
import { api } from '../../lib/api';
import { useDevAuth } from '../../lib/dev-auth';
import { formatDateRange } from '../../lib/id-labels';
import { TOURNAMENT_TABS } from '../../lib/nav-tabs';
import { useApiSWR } from '../../lib/use-api-swr';

/**
 * The same topbar/tab shell as a tournament's own pages (tournaments/[id]/layout.tsx), so moving to
 * "Semua Turnamen" feels like switching tabs, not leaving the app: every other tab the team was just
 * using stays visible and clickable (pointing back at whichever tournament was open), with "Semua
 * Turnamen" simply added as the active one. Only when no tournament is open yet (fresh connect, or
 * right after "Unggah SPS Baru") does just "Semua Turnamen" show, since there is nothing else to
 * point those tabs at.
 */
function Shell({ tournamentId, children }: { tournamentId: string; children: React.ReactNode }) {
  const base = tournamentId ? `/tournaments/${tournamentId}` : '';
  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">
          <BrandMark />
          Taekwondo Bracket Generator
        </span>
      </div>
      <div className="subbar">
        <nav className="tabs">
          <a className="active">Semua Turnamen</a>
          {tournamentId
            ? TOURNAMENT_TABS.map((t) => (
                <a key={t.href} href={`${base}${t.href}`}>
                  {t.label}
                </a>
              ))
            : null}
        </nav>
      </div>
      {children}
    </div>
  );
}

/** AUD-008: the tournaments the current (dev) actor is a member of. Selecting one opens its overview. */
export default function TournamentListPage() {
  const { actorId, tournamentId, setTournament } = useDevAuth();
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApiSWR(actorId ? ['tournaments', actorId] : null, () =>
    api.tournaments(actorId),
  );
  const [archiving, setArchiving] = useState<string | null>(null);

  const uploadNew = () => {
    // Only the tournament id is cleared -- the actor id stays, since it's one shared "Tim" identity
    // for the whole team, not tied to any single tournament. Clearing it too would break re-opening
    // an existing tournament afterwards.
    setTournament('');
    router.push('/');
  };

  const archive = async (id: string, name: string) => {
    if (!window.confirm(`Hapus "${name}" dari daftar turnamen? Datanya tidak hilang, hanya disembunyikan.`))
      return;
    setArchiving(id);
    try {
      await api.archiveTournament(actorId, id);
      await mutate((current) => current?.filter((t) => t.id !== id), { revalidate: false });
    } catch (e) {
      window.alert(`Gagal menghapus: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArchiving(null);
    }
  };

  if (!actorId) {
    return (
      <Shell tournamentId="">
        <main className="content state-empty">
          <p>Belum terhubung. Unggah SPS terlebih dahulu.</p>
          <a className="btn btn-primary" href="/">
            Unggah SPS
          </a>
        </main>
      </Shell>
    );
  }
  if (isLoading)
    return (
      <Shell tournamentId={tournamentId}>
        <main className="content state-loading">Memuat daftar turnamen…</main>
      </Shell>
    );
  if (error)
    return (
      <Shell tournamentId={tournamentId}>
        <main className="content state-error">Gagal memuat daftar turnamen: {error.message}</main>
      </Shell>
    );

  return (
    <Shell tournamentId={tournamentId}>
      <main className="content content-wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <h1>Turnamen</h1>
          <button type="button" className="btn btn-primary" onClick={uploadNew}>
            Unggah SPS Baru
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)' }}>
          Pilih turnamen untuk membuka ringkasan, peserta, dan bagan, atau unggah SPS baru untuk memulai
          kejuaraan lain.
        </p>
        {!data || data.length === 0 ? (
          <div className="panel state-empty" data-testid="tournament-list-empty">
            Belum ada turnamen yang dapat Anda akses.
          </div>
        ) : (
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table aria-label="Daftar turnamen">
              <thead>
                <tr>
                  <th>Turnamen</th>
                  <th>Tanggal</th>
                  <th className="num">Total Peserta</th>
                  <th className="num">Kontingen</th>
                  <th title="Jumlah kategori yang datanya sudah lengkap dan siap diundi, dari total kategori pada bagan terakhir">
                    Kategori Siap
                  </th>
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
                    <td>{formatDateRange(t.eventStart, t.eventEnd)}</td>
                    <td className="num">{t.totalEntries}</td>
                    <td className="num">{t.totalContingents}</td>
                    <td>
                      {t.categoryCounts.total > 0 ? (
                        <>
                          {t.categoryCounts.ready} / {t.categoryCounts.total}
                          {t.categoryCounts.blocked > 0 ? (
                            <span style={{ color: 'var(--red)' }}>
                              {' '}
                              · {t.categoryCounts.blocked} diblokir
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>Belum ada</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <a className="btn" href={`/tournaments/${t.id}`} aria-label={`Buka ${t.name}`}>
                          Buka
                        </a>
                        <button
                          type="button"
                          className="btn btn-danger icon-btn"
                          disabled={archiving === t.id}
                          onClick={() => void archive(t.id, t.name)}
                          aria-label={`Hapus ${t.name}`}
                          title="Hapus turnamen"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </Shell>
  );
}
