'use client';

import { useParams, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { BrandMark } from '../../../components/BrandMark';
import { PersonaSwitcher } from '../../../components/PersonaSwitcher';
import { api } from '../../../lib/api';
import { useDevAuth } from '../../../lib/dev-auth';
import { TOURNAMENT_TABS } from '../../../lib/nav-tabs';
import { useApiSWR } from '../../../lib/use-api-swr';

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
          Taekwondo Indonesia
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
