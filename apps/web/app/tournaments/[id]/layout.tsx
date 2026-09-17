'use client';

import { useParams, usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { PersonaSwitcher } from '../../../components/PersonaSwitcher';
import { useDevAuth } from '../../../lib/dev-auth';

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/categories', label: 'Categories' },
  { href: '/audit', label: 'Audit' },
];

export default function TournamentLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const auth = useDevAuth();

  const { setTournament } = auth;
  useEffect(() => {
    if (params.id && params.id !== auth.tournamentId) setTournament(params.id);
  }, [params.id, auth.tournamentId, setTournament]);

  if (!auth.actorId) {
    return (
      <main className="content state-empty">
        <p>Not connected.</p>
        <a className="btn btn-primary" href="/">
          Connect
        </a>
      </main>
    );
  }

  const base = `/tournaments/${params.id}`;
  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">BaganTKD</span>
        <nav className="tabs">
          {TABS.map((t) => {
            const href = `${base}${t.href}`;
            const active = t.href === '' ? pathname === base : pathname.startsWith(href);
            return (
              <a key={t.href} href={href} className={active ? 'active' : ''}>
                {t.label}
              </a>
            );
          })}
        </nav>
        <PersonaSwitcher />
      </div>
      {children}
    </div>
  );
}
