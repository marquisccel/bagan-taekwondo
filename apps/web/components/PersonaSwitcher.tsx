'use client';

import { useDevAuth } from '../lib/dev-auth';

/**
 * Shows who is acting in this session. There is deliberately no role-switching UI: the whole team
 * shares one actor with full access (ADR "no role gating" -- everyone runs every step of the flow),
 * so a dropdown here would just be a single, pointless option.
 */
export function PersonaSwitcher() {
  const { membersError } = useDevAuth();

  if (membersError) return null;

  return <span className="badge badge-neutral">Admin</span>;
}
