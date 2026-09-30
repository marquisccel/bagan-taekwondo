'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { BrandMark } from '../../../components/BrandMark';
import { api } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import { TOURNAMENT_TABS } from '../../../lib/nav-tabs';
import { useApiSWR } from '../../../lib/use-api-swr';
import { useNow } from '../../../lib/use-now';

/** Sits where the old static "Admin" badge used to -- the top-right corner of every tournament page,
 * not just the dashboard, since it's a page-independent fact of "when is it right now". */
function TopbarClock() {
  const now = useNow();
  const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="topbar-clock">
      <div className="topbar-clock-time">{time}</div>
      <div className="topbar-clock-date">{date}</div>
    </div>
  );
}

export default function TournamentLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const auth = useDevAuth();

  const { setTournament } = auth;
  useEffect(() => {
    if (params.id && params.id !== auth.tournamentId) setTournament(params.id);
  }, [params.id, auth.tournamentId, setTournament]);

  const { data: tournament } = useApiSWR(
    auth.actorId && params.id ? ['tournament', params.id, auth.actorId] : null,
    () => api.tournament(auth.actorId, params.id),
  );

  // An older link/bookmark, or a tab left open from before tournament codes existed, can still carry
  // the tournament's raw uuid in the address bar. The backend accepts either (see ActorGuard), but
  // the uuid is what a bookmark or a shared link then keeps forever unless we swap it out ourselves
  // once we know the real code -- so the address bar always settles on the readable form.
  useEffect(() => {
    if (tournament && tournament.code && tournament.code !== params.id) {
      router.replace(pathname.replace(params.id, tournament.code));
    }
  }, [tournament, params.id, pathname, router]);

  if (!auth.actorId) {
    return (
      <main className="content state-empty">
        <p>Belum terhubung ke turnamen mana pun.</p>
        <a className="btn btn-primary" href="/">
          Hubungkan
        </a>
      </main>
    );
  }

  const base = `/tournaments/${params.id}`;
  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">
          <BrandMark />
          Taekwondo Bracket Generator
        </span>
        <span className="topbar-divider" aria-hidden="true" />
        <span className="topbar-tournament">{tournament?.name ?? ' '}</span>
        <span className="topbar-spacer" />
        <TopbarClock />
      </div>
      <div className="subbar">
        <nav className="tabs">
          <a href="/tournaments">Semua Turnamen</a>
          {TOURNAMENT_TABS.map((t) => {
            const href = `${base}${t.href}`;
            const active = t.href === '' ? pathname === base : pathname.startsWith(href);
            return (
              <a key={t.href} href={href} className={active ? 'active' : ''}>
                {t.label}
              </a>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
