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
      activeRuleSetStatus: 'DRAFT',
      latestDrawRun: null,
      latestRevision: null,
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/no draw run yet/i)).toBeInTheDocument();
    expect(screen.getByText(/is DRAFT, not ACTIVE/)).toBeInTheDocument();
  });

  it('shows draw run status, revision status, and blocked/warning counts once a draw run exists', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
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
    expect(await screen.findByText('SAFE')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('8 / 10')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse categories/i })).toHaveAttribute(
      'href',
      '/tournaments/t1/categories',
    );
  });
});
