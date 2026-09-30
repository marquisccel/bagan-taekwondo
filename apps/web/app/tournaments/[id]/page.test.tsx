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
      participantsNeedingReview: 0,
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
      participantsNeedingReview: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText('142')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Total Peserta')).toBeInTheDocument();
    expect(screen.getByText('Kontingen')).toBeInTheDocument();
  });

  it('offers Cek & Atur Bagan and Ekspor as the primary actions once a revision exists, without repeating the quiet-success sentence', async () => {
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
      participantsNeedingReview: 5,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText('8 / 10')).toBeInTheDocument();
    expect(screen.getByText('Kategori Siap')).toBeInTheDocument();
    // A quietly-successful (SAFE) run isn't repeated as a sentence -- the button below already says it.
    expect(screen.queryByText(/Bagan berhasil dibuat/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cek & atur bagan/i })).toHaveAttribute(
      'href',
      '/tournaments/t1/sesi/rev-1',
    );
    // Ekspor is embedded in the greeting card, not a separate panel of its own.
    expect(screen.getByRole('button', { name: 'Buat Ekspor' })).toBeInTheDocument();
    // "Perlu Ditinjau" counts (and links to) the exact same participants Peserta's own
    // ?review=NEEDS_REVIEW filter shows -- never the draw's own blocked/error/warning figures.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Perlu Ditinjau')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /perlu ditinjau/i })).toHaveAttribute(
      'href',
      '/tournaments/t1/peserta?review=NEEDS_REVIEW',
    );
  });

  it('greets the operator by time of day instead of a static Admin badge', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      id: 't1',
      code: 'T1',
      name: 'Piala Test',
      eventStart: '2026-08-27',
      eventEnd: '2026-08-30',
      totalEntries: 0,
      totalContingents: 0,
      activeRuleSetStatus: 'ACTIVE',
      latestDrawRun: null,
      latestRevision: null,
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
      participantsNeedingReview: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/selamat (pagi|siang|sore|malam), admin/i)).toBeInTheDocument();
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
      participantsNeedingReview: 0,
    });
    renderIsolated(<TournamentOverviewPage />);
    expect(await screen.findByText(/perlu ditinjau sebelum dipakai/i)).toBeInTheDocument();
    expect(screen.queryByText('Kandidat')).not.toBeInTheDocument();
    expect(screen.queryByText('Tidak aman')).not.toBeInTheDocument();
  });
});
