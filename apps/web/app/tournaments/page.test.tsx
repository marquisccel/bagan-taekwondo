import { render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type TournamentListItem } from '../../lib/api';
import { useDevAuth } from '../../lib/dev-auth';
import TournamentListPage from './page';

vi.mock('../../lib/api', () => ({ api: { tournaments: vi.fn() } }));
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
    vi.mocked(useDevAuth).mockReturnValue({ actorId: 'actor-1' } as ReturnType<typeof useDevAuth>);
    vi.mocked(api.tournaments).mockReset();
  });

  it('asks the operator to connect when there is no actor', () => {
    vi.mocked(useDevAuth).mockReturnValue({ actorId: '' } as ReturnType<typeof useDevAuth>);
    renderIsolated(<TournamentListPage />);
    expect(screen.getByText(/belum terhubung/i)).toBeInTheDocument();
    expect(api.tournaments).not.toHaveBeenCalled();
  });

  it('lists each tournament with name, code, dates, draw and revision state, and a link to open it', async () => {
    vi.mocked(api.tournaments).mockResolvedValue([
      item(),
      item({
        id: 't2',
        name: 'Kejuaraan Kota',
        code: 'KK',
        status: 'DRAFT',
        activeRuleSetStatus: 'NONE',
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
    expect(first.getByText('PG-2026')).toBeInTheDocument();
    expect(first.getAllByText('Aktif', { selector: 'td' })).toHaveLength(2); // tournament status + rule set
    expect(first.getByText(/Aman/)).toBeInTheDocument();
    expect(first.getByText(/#2 · Tinjauan/)).toBeInTheDocument();
    expect(first.getByText(/8 \/ 10/)).toBeInTheDocument();
    expect(first.getByText(/2 diblokir/)).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Buka Piala Gubernur 2026' })).toHaveAttribute(
      'href',
      '/tournaments/t1',
    );

    const second = within(rows[1] as HTMLElement);
    expect(second.getByText('Belum ada', { selector: 'span' })).toBeInTheDocument();
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
});
