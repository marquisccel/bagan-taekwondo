import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';
import { LifecycleBar } from './LifecycleBar';

vi.mock('../lib/api', () => ({
  api: { submitReview: vi.fn(), approve: vi.fn(), lock: vi.fn(), publish: vi.fn(), amend: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock('../lib/dev-auth', () => ({ useDevAuth: vi.fn() }));

const mockAuth = (role: string | null) =>
  vi.mocked(useDevAuth).mockReturnValue({
    actorId: 'actor-1',
    role,
    tournamentId: 't1',
    displayName: null,
    members: [],
    membersError: null,
    setTournament: vi.fn(),
    setActor: vi.fn(),
    disconnect: vi.fn(),
  } as never);

describe('LifecycleBar', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the next action for the current lifecycle state (LOCKED -> Terbitkan Drawing)', () => {
    mockAuth('TECHNICAL_DELEGATE');
    render(
      <LifecycleBar
        lifecycle="LOCKED"
        lockVersion={2}
        revisionId="r1"
        onChanged={() => undefined}
        onConflict={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Terbitkan Drawing' })).toBeEnabled();
  });

  it('disables the action and explains the required role (in Indonesian) when the current actor is below it', () => {
    mockAuth('DRAWING_OFFICER');
    render(
      <LifecycleBar
        lifecycle="LOCKED"
        lockVersion={2}
        revisionId="r1"
        onChanged={() => undefined}
        onConflict={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Terbitkan Drawing' })).toBeDisabled();
    expect(screen.getByText(/Minimal peran: Delegasi Teknis/)).toBeInTheDocument();
  });

  it('calls onChanged when the command is applied', async () => {
    mockAuth('TECHNICAL_DELEGATE');
    vi.mocked(api.lock).mockResolvedValue({
      outcome: 'APPLIED',
      rejectionCode: null,
      verdict: { level: 'GREEN' },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    const onChanged = vi.fn();
    render(
      <LifecycleBar
        lifecycle="APPROVED"
        lockVersion={1}
        revisionId="r1"
        onChanged={onChanged}
        onConflict={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kunci Drawing' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('calls onConflict, not onChanged, on REVISION_CONFLICT — never silently retries', async () => {
    mockAuth('TECHNICAL_DELEGATE');
    vi.mocked(api.lock).mockResolvedValue({
      outcome: 'REJECTED',
      rejectionCode: 'REVISION_CONFLICT',
      verdict: { level: 'RED', hardViolations: ['stale'] },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    const onChanged = vi.fn();
    const onConflict = vi.fn();
    render(
      <LifecycleBar
        lifecycle="APPROVED"
        lockVersion={1}
        revisionId="r1"
        onChanged={onChanged}
        onConflict={onConflict}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kunci Drawing' }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledOnce());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows a safe operator-facing message on FORBIDDEN_COMMAND', async () => {
    mockAuth('TECHNICAL_DELEGATE');
    vi.mocked(api.lock).mockResolvedValue({
      outcome: 'REJECTED',
      rejectionCode: 'FORBIDDEN_COMMAND',
      verdict: { level: 'RED', hardViolations: [] },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    render(
      <LifecycleBar
        lifecycle="APPROVED"
        lockVersion={1}
        revisionId="r1"
        onChanged={() => undefined}
        onConflict={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kunci Drawing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak memiliki izin/i);
  });
});
