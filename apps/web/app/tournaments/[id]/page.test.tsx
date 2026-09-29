import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../../lib/api';
import TournamentOverviewPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }) }));
vi.mock('../../../lib/api', () => ({ api: { tournament: vi.fn() } }));
vi.mock('../../../lib/dev-auth', () => ({ useDevAuth: vi.fn(() => ({ actorId: 'actor-1' })) }));

/** Each test gets its own SWR cache — otherwise the second test's differently-mocked response is
 * masked by a still-warm cache entry from the first test using the same key. */
function renderIsolated(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

describe('TournamentOverviewPage (read-only)', () => {
  it('shows the empty state when no draw run has been requested yet', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
      totalEntries: 0,
      totalContingents: 0,
      activeRuleSetStatus: 'DRAFT',
      latestDrawRun: null,
      latestRevision: null,
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/belum ada bagan/i)).toBeInTheDocument();
    expect(screen.getByText(/berstatus Draf, belum Aktif/)).toBeInTheDocument();
  });

  it('shows the event date range and participation totals', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
      totalEntries: 142,
      totalContingents: 18,
      activeRuleSetStatus: 'ACTIVE',
      latestDrawRun: null,
      latestRevision: null,
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText('142')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Total Peserta')).toBeInTheDocument();
    expect(screen.getByText('Kontingen')).toBeInTheDocument();
  });

  it('summarizes a successful draw run in plain language, and combines blocked/error/warning counts into one attention figure', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
      totalEntries: 100,
      totalContingents: 12,
      activeRuleSetStatus: 'ACTIVE',
      latestDrawRun: {
        id: 'run-1',
        status: 'SAFE',
        kind: 'CANDIDATE',
        requestedAt: new Date().toISOString(),
        finishedAt: null,
      },
      latestRevision: { id: 'rev-1', revision_no: 1, lifecycle: 'DRAFT', lock_version: 0 },
      categoryCounts: { total: 10, ready: 8, blocked: 2 },
      warningCount: 3,
      errorCount: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/Bagan berhasil dibuat/)).toHaveTextContent('Status: Draf');
    expect(screen.getByText('8 / 10')).toBeInTheDocument();
    expect(screen.getByText('Kategori Siap')).toBeInTheDocument();
    // 2 blocked + 0 errors + 3 warnings = 5, shown as one "needs a look" figure, not 3 separate ones.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Perlu Ditinjau')).toBeInTheDocument();
    expect(screen.queryByText('Kategori Diblokir')).not.toBeInTheDocument();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cek & atur bagan/i })).toHaveAttribute(
      'href',
      '/tournaments/t1/sesi/rev-1',
    );
  });

  it('tells a committee member a draw needs review, in plain language, without exposing the engine kind/status words', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
      totalEntries: 100,
      totalContingents: 12,
      activeRuleSetStatus: 'ACTIVE',
      latestDrawRun: {
        id: 'run-1',
        status: 'UNSAFE',
        kind: 'CANDIDATE',
        requestedAt: new Date().toISOString(),
        finishedAt: null,
      },
      latestRevision: { id: 'rev-1', revision_no: 1, lifecycle: 'DRAFT', lock_version: 0 },
      categoryCounts: { total: 10, ready: 8, blocked: 2 },
      warningCount: 0,
      errorCount: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/perlu ditinjau sebelum dipakai/i)).toBeInTheDocument();
    expect(screen.queryByText('Kandidat')).not.toBeInTheDocument();
    expect(screen.queryByText('Tidak aman')).not.toBeInTheDocument();
  });
});
