import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../../../../lib/api';
import DrawRunPage from './page';

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 't1', drawRunId: 'run-1' }),
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));
vi.mock('../../../../../lib/api', () => ({
  api: { drawRun: vi.fn(), tournament: vi.fn() },
}));
vi.mock('../../../../../lib/dev-auth', () => ({ useDevAuth: vi.fn(() => ({ actorId: 'actor-1' })) }));

/** Each test gets its own SWR cache — otherwise the second test's differently-mocked response is
 * masked by a still-warm cache entry from the first test using the same key. */
function renderIsolated(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

const baseRun = {
  id: 'run-1',
  tournament_id: 't1',
  rule_set_id: 'rs1',
  kind: 'CANDIDATE' as const,
  seed: '1',
  engine_version: '0.2.0',
  rules_fingerprint: 'sha256:rules',
  input_fingerprint: 'sha256:input',
  output_fingerprint: null,
  scope: [],
  dual_run_match: null,
  duration_ms: null,
  requested_by: 'u1',
  requested_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
};

describe('DrawRunPage — a waiting room, not a destination', () => {
  it('shows a plain retry message for an UNSAFE run, with no raw engine internals', async () => {
    vi.mocked(api.drawRun).mockResolvedValue({
      ...baseRun,
      status: 'UNSAFE',
      unsafe_reasons: [{ code: 'NO_ELIGIBLE_ENTRIES' }],
    });
    renderIsolated(<DrawRunPage />);
    expect(await screen.findByText(/tidak aman untuk dipakai/i)).toBeInTheDocument();
    expect(screen.queryByText(/sha256:rules/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kembali ke jadwal/i })).toHaveAttribute(
      'href',
      '/tournaments/t1/jadwal',
    );
  });

  it('redirects straight to the session page once SAFE, with no manual click', async () => {
    vi.mocked(api.drawRun).mockResolvedValue({ ...baseRun, status: 'SAFE', unsafe_reasons: [] });
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
      latestRevision: { id: 'rev-1', revision_no: 1, lifecycle: 'DRAFT', lock_version: 0 },
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
      participantsNeedingReview: 0,
    });
    renderIsolated(<DrawRunPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tournaments/t1/sesi/rev-1'));
  });

  it('forwards the dayNumber/arenaCode it was opened with onto the session redirect, so the session page can filter to that same slot', async () => {
    searchParams = new URLSearchParams({ dayNumber: '1', arenaCode: 'C' });
    vi.mocked(api.drawRun).mockResolvedValue({ ...baseRun, status: 'SAFE', unsafe_reasons: [] });
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
      latestRevision: { id: 'rev-1', revision_no: 1, lifecycle: 'DRAFT', lock_version: 0 },
      categoryCounts: { total: 0, ready: 0, blocked: 0 },
      warningCount: 0,
      errorCount: 0,
      participantsNeedingReview: 0,
    });
    renderIsolated(<DrawRunPage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/tournaments/t1/sesi/rev-1?dayNumber=1&arenaCode=C'),
    );
    searchParams = new URLSearchParams();
  });
});
