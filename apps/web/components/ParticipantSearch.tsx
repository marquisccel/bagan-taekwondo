'use client';

import { useEffect, useState } from 'react';

import { api, type SearchResult } from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';

/** Search participant/contingent (ACCEPTANCE §B) — jumps straight to the category they're in. */
export function ParticipantSearch({ tournamentId }: { tournamentId: string }) {
  const { actorId } = useDevAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .search(actorId, tournamentId, q)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, actorId, tournamentId]);

  return (
    <div style={{ position: 'relative', maxWidth: 320 }}>
      <input
        aria-label="Search participant or contingent"
        placeholder="Search participant or contingent…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: '100%' }}
      />
      {open && results.length > 0 ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginTop: 4,
            maxHeight: 260,
            overflowY: 'auto',
            listStyle: 'none',
            padding: 4,
            zIndex: 10,
          }}
        >
          {results.map((r) => (
            <li key={r.entry_id}>
              {r.category_id ? (
                <a
                  href={`/tournaments/${tournamentId}/categories/${r.category_id}`}
                  style={{ display: 'block', padding: '6px 8px', borderRadius: 4 }}
                >
                  <strong>{r.external_ref ?? r.entry_id}</strong> — {r.contingent}
                  <br />
                  <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                    {r.category_key ?? 'unassigned category'}
                  </span>
                </a>
              ) : (
                <span style={{ display: 'block', padding: '6px 8px', color: 'var(--text-dim)' }}>
                  {r.external_ref ?? r.entry_id} — {r.contingent} (no category yet)
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
