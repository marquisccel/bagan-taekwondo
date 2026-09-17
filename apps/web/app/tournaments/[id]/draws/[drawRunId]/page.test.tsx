import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../../../../lib/api';
import DrawRunPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1', drawRunId: 'run-1' }) }));
vi.mock('../../../../../lib/api', () => ({ api: { drawRun: vi.fn(), drawRunQuality: vi.fn() } }));
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

describe('DrawRunPage — unsafe/blocked state', () => {
  it('shows an UNSAFE run as Blocked, with its unsafe reasons, and does not offer to browse categories', async () => {
    vi.mocked(api.drawRun).mockResolvedValue({
      ...baseRun,
      status: 'UNSAFE',
      unsafe_reasons: [{ code: 'NO_ELIGIBLE_ENTRIES' }],
    });
    renderIsolated(<DrawRunPage />);
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText(/this draw run is unsafe/i)).toBeInTheDocument();
    expect(screen.getByText(/NO_ELIGIBLE_ENTRIES/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /browse categories/i })).not.toBeInTheDocument();
  });

  it('shows a SAFE run as OK and offers to browse categories', async () => {
    vi.mocked(api.drawRun).mockResolvedValue({
      ...baseRun,
      status: 'SAFE',
      unsafe_reasons: [],
      output_fingerprint: 'sha256:out',
    });
    vi.mocked(api.drawRunQuality).mockResolvedValue({
      report: {},
      fingerprint: 'sha256:q',
      error_count: 0,
      warning_count: 1,
      info_count: 0,
    });
    renderIsolated(<DrawRunPage />);
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse categories/i })).toBeInTheDocument();
  });
});
