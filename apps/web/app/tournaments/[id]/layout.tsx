'use client';

import { useParams, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { PersonaSwitcher } from '../../../components/PersonaSwitcher';
import { api } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import { TOURNAMENT_TABS } from '../../../lib/nav-tabs';
import { useApiSWR } from '../../../lib/use-api-swr';

/** A simple geometric bracket mark: two lines converging like a single-elimination bracket. */
function BrandMark() {
  return (
    <svg className="brand-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 3.5H6.5V8.25H2M2 14.5H6.5V9.75H2M6.5 6H10.5V12H6.5M10.5 9H16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TournamentLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const auth = useDevAuth();

  const { setTournament } = auth;
  useEffect(() => {
    if (params.id && params.id !== auth.tournamentId) setTournament(params.id);
  }, [params.id, auth.tournamentId, setTournament]);

  const { data: tournament } = useApiSWR(
    auth.actorId && params.id ? ['tournament', params.id, auth.actorId] : null,
    () => api.tournament(auth.actorId, params.id),
  );

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
        <PersonaSwitcher />
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
