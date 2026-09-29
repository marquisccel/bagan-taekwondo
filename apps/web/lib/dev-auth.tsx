'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, type TournamentMember } from './api';

/**
 * DEV AUTH ONLY. There is no login system in this repository (Phase 4 accepted `x-actor-id` as a
 * stand-in for whatever real auth eventually sits in front of it — see apps/api/src/auth/actor.ts).
 * The team doesn't type any id by hand: uploading an SPS spreadsheet (`/`) bootstraps a brand-new
 * tournament and a shared "Tim" actor with full access (no role distinction -- ADR "no role
 * gating"), and the app remembers both ids in localStorage from then on (`connect`, below). This is
 * NOT a production authentication system and must not be mistaken for one.
 */
interface DevAuthValue {
  readonly tournamentId: string;
  readonly actorId: string;
  readonly role: TournamentMember['role'] | null;
  readonly displayName: string | null;
  readonly members: readonly TournamentMember[];
  readonly membersError: string | null;
  readonly setTournament: (id: string) => void;
  readonly setActor: (id: string) => void;
  readonly disconnect: () => void;
}

const Ctx = createContext<DevAuthValue | null>(null);

const TOURNAMENT_KEY = 'bagantkd.dev.tournamentId';
const ACTOR_KEY = 'bagantkd.dev.actorId';

function readStorage(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [tournamentId, setTournamentIdState] = useState('');
  const [actorId, setActorIdState] = useState('');
  const [members, setMembers] = useState<readonly TournamentMember[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    setTournamentIdState(readStorage(TOURNAMENT_KEY));
    setActorIdState(readStorage(ACTOR_KEY));
  }, []);

  useEffect(() => {
    if (!tournamentId || !actorId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    api
      .members(actorId, tournamentId)
      .then((m) => {
        if (!cancelled) {
          setMembers(m);
          setMembersError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setMembersError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, actorId]);

  const setTournament = (id: string) => {
    setTournamentIdState(id);
    try {
      window.localStorage.setItem(TOURNAMENT_KEY, id);
    } catch {
      /* private browsing: identity just won't survive a reload */
    }
  };
  const setActor = (id: string) => {
    setActorIdState(id);
    try {
      window.localStorage.setItem(ACTOR_KEY, id);
    } catch {
      /* ignore */
    }
  };
  const disconnect = () => {
    setTournament('');
    setActor('');
  };

  const self = members.find((m) => m.user_id === actorId) ?? null;
  const value = useMemo<DevAuthValue>(
    () => ({
      tournamentId,
      actorId,
      role: self?.role ?? null,
      displayName: self?.display_name ?? null,
      members,
      membersError,
      setTournament,
      setActor,
      disconnect,
    }),
    [tournamentId, actorId, self, members, membersError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevAuth(): DevAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDevAuth used outside DevAuthProvider');
  return ctx;
}
