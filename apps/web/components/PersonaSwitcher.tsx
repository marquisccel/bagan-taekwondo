'use client';

import { useDevAuth } from '../lib/dev-auth';

/** DEV AUTH ONLY: switches which existing tournament member the browser acts as. */
export function PersonaSwitcher() {
  const { actorId, role, displayName, members, membersError, setActor } = useDevAuth();

  if (membersError) return <span style={{ color: 'var(--red)', fontSize: 12 }}>members: {membersError}</span>;

  return (
    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
      Acting as
      <select aria-label="Acting as" value={actorId} onChange={(e) => setActor(e.target.value)}>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.display_name} ({m.role})
          </option>
        ))}
      </select>
      {displayName ? null : role ? null : <span style={{ color: 'var(--yellow)' }}>unknown actor</span>}
    </label>
  );
}
