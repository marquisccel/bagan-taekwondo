'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useDevAuth } from '../lib/dev-auth';

export default function ConnectPage() {
  const { tournamentId, actorId, setTournament, setActor } = useDevAuth();
  const [tid, setTid] = useState(tournamentId);
  const [aid, setAid] = useState(actorId);
  const router = useRouter();

  const connect = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTournament(tid.trim());
    setActor(aid.trim());
    router.push(`/tournaments/${tid.trim()}`);
  };

  return (
    <main className="content" style={{ maxWidth: 480 }}>
      <h1>BaganTKD Operator</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Enter a tournament id and your user id (from a seed script or another operator) to connect. This is a
        development identity adapter, not a login system — see lib/dev-auth.tsx.
      </p>
      <form onSubmit={connect} className="panel grid" style={{ maxWidth: 420 }}>
        <label>
          Tournament ID
          <br />
          <input
            value={tid}
            onChange={(e) => setTid(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            style={{ width: '100%' }}
            required
          />
        </label>
        <label>
          Your user ID
          <br />
          <input
            value={aid}
            onChange={(e) => setAid(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            style={{ width: '100%' }}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Connect
        </button>
      </form>
      {tournamentId && actorId ? (
        <p>
          Currently connected to tournament <code>{tournamentId}</code> as <code>{actorId}</code>. Go to{' '}
          <a href={`/tournaments/${tournamentId}`}>the dashboard</a>.
        </p>
      ) : null}
    </main>
  );
}
