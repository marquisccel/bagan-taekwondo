import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type TournamentListItem } from '../../lib/api';
import { useDevAuth } from '../../lib/dev-auth';
import TournamentListPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/api', () => ({ api: { tournaments: vi.fn(), archiveTournament: vi.fn() } }));
vi.mock('../../lib/dev-auth', () => ({ useDevAuth: vi.fn() }));

const renderIsolated = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const item = (over: Partial<TournamentListItem> = {}): TournamentListItem => ({
  id: 't1',
  code: 'PG-2026',
  name: 'Piala Gubernur 2026',
  status: 'ACTIVE',
  eventStart: '2026-08-27',
  eventEnd: '2026-08-30',
  activeRuleSetStatus: 'ACTIVE',
  totalEntries: 142,
  totalContingents: 18,
  latestDrawRun: {
    id: 'run-1',
    status: 'SAFE',
    kind: 'CANDIDATE',
    requestedAt: '2026-08-01T10:00:00.000Z',
    finishedAt: null,
  },
  latestRevision: { id: 'rev-1', revision_no: 2, lifecycle: 'REVIEW', lock_version: 3 },
  categoryCounts: { total: 10, ready: 8, blocked: 2 },
  ...over,
});

describe('TournamentListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useDevAuth).mockReturnValue({ actorId: 'actor-1' } as ReturnType<typeof useDevAuth>);
    vi.mocked(api.tournaments).mockReset();
    vi.mocked(api.archiveTournament).mockReset();
  });

  it('asks the operator to connect when there is no actor', () => {
    vi.mocked(useDevAuth).mockReturnValue({ actorId: '' } as ReturnType<typeof useDevAuth>);
    renderIsolated(<TournamentListPage />);
    expect(screen.getByText(/belum terhubung/i)).toBeInTheDocument();
    expect(api.tournaments).not.toHaveBeenCalled();
  });

  it('lists each tournament with name, dates, participant/contingent totals, category readiness, and a link to open it', async () => {
    vi.mocked(api.tournaments).mockResolvedValue([
      item(),
      item({
        id: 't2',
        name: 'Kejuaraan Kota',
        code: 'KK',
        status: 'DRAFT',
        activeRuleSetStatus: 'NONE',
        totalEntries: 0,
        totalContingents: 0,
        latestDrawRun: null,
        latestRevision: null,
        categoryCounts: { total: 0, ready: 0, blocked: 0 },
      }),
    ]);
    renderIsolated(<TournamentListPage />);
    expect(await screen.findByRole('heading', { name: 'Turnamen' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('tournament-row');
    expect(rows).toHaveLength(2);

    const first = within(rows[0] as HTMLElement);
    expect(first.getByRole('link', { name: 'Piala Gubernur 2026' })).toHaveAttribute(
      'href',
      '/tournaments/t1',
    );
    expect(first.getByText('142')).toBeInTheDocument();
    expect(first.getByText('18')).toBeInTheDocument();
    expect(first.getByText(/8 \/ 10/)).toBeInTheDocument();
    expect(first.getByText(/2 diblokir/)).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Buka Piala Gubernur 2026' })).toHaveAttribute(
      'href',
      '/tournaments/t1',
    );

    const second = within(rows[1] as HTMLElement);
    expect(second.getByText('Belum ada')).toBeInTheDocument(); // Kategori Siap, no draw run yet
    expect(second.getByRole('link', { name: 'Buka Kejuaraan Kota' })).toHaveAttribute(
      'href',
      '/tournaments/t2',
    );
    expect(api.tournaments).toHaveBeenCalledWith('actor-1');
  });

  it('shows an Indonesian empty state when the actor has no tournaments', async () => {
    vi.mocked(api.tournaments).mockResolvedValue([]);
    renderIsolated(<TournamentListPage />);
    expect(await screen.findByTestId('tournament-list-empty')).toHaveTextContent(/belum ada turnamen/i);
  });

  it('shows the backend error', async () => {
    vi.mocked(api.tournaments).mockRejectedValue(new Error('boom'));
    renderIsolated(<TournamentListPage />);
    expect(await screen.findByText(/gagal memuat daftar turnamen: boom/i)).toBeInTheDocument();
  });

  it('archives a tournament (after confirming) and removes it from the list without a full reload', async () => {
    vi.mocked(api.tournaments).mockResolvedValue([item()]);
    vi.mocked(api.archiveTournament).mockResolvedValue({ status: 'ARCHIVED' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderIsolated(<TournamentListPage />);
    await screen.findByTestId('tournament-row');

    fireEvent.click(screen.getByRole('button', { name: 'Hapus Piala Gubernur 2026' }));

    await waitFor(() => expect(api.archiveTournament).toHaveBeenCalledWith('actor-1', 't1'));
    await waitFor(() => expect(screen.queryByTestId('tournament-row')).not.toBeInTheDocument());
  });

  it('does nothing when the archive confirmation is declined', async () => {
    vi.mocked(api.tournaments).mockResolvedValue([item()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderIsolated(<TournamentListPage />);
    await screen.findByTestId('tournament-row');

    fireEvent.click(screen.getByRole('button', { name: 'Hapus Piala Gubernur 2026' }));

    expect(api.archiveTournament).not.toHaveBeenCalled();
    expect(screen.getByTestId('tournament-row')).toBeInTheDocument();
  });
});
