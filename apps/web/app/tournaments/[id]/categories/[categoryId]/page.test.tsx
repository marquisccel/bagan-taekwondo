import { fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { api } from '../../../../../lib/api';
import CategoryDetailPage from './page';

/** Each test gets its own SWR cache — otherwise a later test's differently-mocked response is
 * masked by a still-warm cache entry from an earlier test using the same key. */
function renderIsolated(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 't1', categoryId: 'cat-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../../../../lib/api', () => ({
  api: {
    tournament: vi.fn(),
    revision: vi.fn(),
    categories: vi.fn(),
    category: vi.fn(),
    moveEntry: vi.fn(),
    swapEntry: vi.fn(),
    movePool: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../../../../lib/dev-auth', () => ({
  useDevAuth: vi.fn(() => ({ actorId: 'actor-1', role: 'DRAWING_OFFICER' })),
}));

const tournament = {
  id: 't1',
  code: 'T1',
  name: 'Test',
  eventStart: '2026-08-27',
  eventEnd: '2026-08-30',
  totalEntries: 0,
  totalContingents: 0,
  activeRuleSetStatus: 'ACTIVE',
  latestDrawRun: { id: 'run-1', status: 'SAFE', kind: 'CANDIDATE', requestedAt: '', finishedAt: null },
  latestRevision: { id: 'rev-1', revision_no: 1, lifecycle: 'DRAFT', lock_version: 3 },
  categoryCounts: { total: 1, ready: 1, blocked: 0 },
  warningCount: 0,
  errorCount: 0,
  participantsNeedingReview: 0,
};
const revision = {
  id: 'rev-1',
  tournament_id: 't1',
  draw_run_id: 'run-1',
  revision_no: 1,
  parent_revision_id: null,
  lifecycle: 'DRAFT' as const,
  content_fingerprint: null,
  lock_version: 3,
  created_at: '',
  submitted_at: null,
  approved_at: null,
  locked_at: null,
  published_at: null,
};
const categories = [
  {
    category_id: 'cat-1',
    category_key: 'KYORUGI-1',
    stream: 'PRESTASI',
    discipline: 'KYORUGI',
    format: 'INDIVIDUAL',
    gender: 'MALE',
    movement: null,
    readiness: 'READY' as const,
    blocked_reasons: [],
    selected_strategy: 'BALANCED',
    poolCount: 2,
    entryCount: 2,
    quality: 'GREEN' as const,
  },
];
const budi = { entryId: 'e1', externalRef: 'R1', contingent: 'Kota A', displayName: 'Budi', athletes: [] };
const rudi = { entryId: 'e2', externalRef: 'R2', contingent: 'Kota B', displayName: 'Rudi', athletes: [] };
const detail = {
  category: {
    id: 'cat-1',
    category_key: 'KYORUGI-1',
    stream: 'PRESTASI',
    discipline: 'KYORUGI',
    format: 'INDIVIDUAL',
    gender: 'MALE',
    movement: null,
  },
  readiness: 'READY' as const,
  blockedReasons: [],
  selectedStrategy: 'BALANCED',
  pools: [
    {
      id: 'p1',
      poolUid: 'POOL-A',
      ordinal: 1,
      isWalkover: false,
      metrics: {},
      explanation: [],
      members: [budi],
      bracket: null,
    },
    {
      id: 'p2',
      poolUid: 'POOL-B',
      ordinal: 2,
      isWalkover: false,
      metrics: {},
      explanation: [],
      members: [rudi],
      bracket: null,
    },
  ],
};

function setupHappyPath() {
  vi.mocked(api.tournament).mockResolvedValue(tournament);
  vi.mocked(api.revision).mockResolvedValue(revision);
  vi.mocked(api.categories).mockResolvedValue(categories);
  vi.mocked(api.category).mockResolvedValue(detail);
}

describe('CategoryDetailPage', () => {
  it('moving an entry via the keyboard-accessible dialog sends the correct MoveEntry command (expectedLockVersion from the loaded revision)', async () => {
    setupHappyPath();
    vi.mocked(api.moveEntry).mockResolvedValue({
      outcome: 'APPLIED',
      rejectionCode: null,
      verdict: { level: 'GREEN' },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    renderIsolated(<CategoryDetailPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pindahkan' }))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: /Pool 2/ }));

    expect(api.moveEntry).toHaveBeenCalledWith(
      'actor-1',
      'rev-1',
      expect.objectContaining({ entryId: 'e1', toPoolUid: 'POOL-B', expectedLockVersion: 3 }),
    );
  });

  it('shows the reload banner on REVISION_CONFLICT instead of applying the move', async () => {
    setupHappyPath();
    vi.mocked(api.moveEntry).mockResolvedValue({
      outcome: 'REJECTED',
      rejectionCode: 'REVISION_CONFLICT',
      verdict: { level: 'RED', hardViolations: ['stale'] },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    renderIsolated(<CategoryDetailPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pindahkan' }))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: /Pool 2/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/diperbarui oleh pengguna lain/i);
  });

  it('shows a safe message on FORBIDDEN_COMMAND, not a raw error', async () => {
    setupHappyPath();
    vi.mocked(api.moveEntry).mockResolvedValue({
      outcome: 'REJECTED',
      rejectionCode: 'FORBIDDEN_COMMAND',
      verdict: { level: 'RED', hardViolations: [] },
      resultingRevisionId: null,
      commandRowId: 'c1',
      replayed: false,
    });
    renderIsolated(<CategoryDetailPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pindahkan' }))[0]!);
    fireEvent.click(await screen.findByRole('button', { name: /Pool 2/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak memiliki izin/i);
  });

  it('shows blocked reasons and no editable actions when the category is BLOCKED', async () => {
    vi.mocked(api.tournament).mockResolvedValue(tournament);
    vi.mocked(api.revision).mockResolvedValue(revision);
    vi.mocked(api.categories).mockResolvedValue([
      { ...categories[0]!, readiness: 'BLOCKED', quality: 'RED' },
    ]);
    vi.mocked(api.category).mockResolvedValue({
      ...detail,
      readiness: 'BLOCKED',
      blockedReasons: [{ code: 'NO_ELIGIBLE_ENTRIES' }],
      pools: [],
    });
    renderIsolated(<CategoryDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Diblokir' })).toBeInTheDocument();
    expect(screen.getByText(/NO_ELIGIBLE_ENTRIES/)).toBeInTheDocument();
  });

  it('disables moves and swaps when the revision is not DRAFT (read-only/locked)', async () => {
    vi.mocked(api.tournament).mockResolvedValue({
      ...tournament,
      latestRevision: { ...tournament.latestRevision, lifecycle: 'LOCKED' },
    });
    vi.mocked(api.revision).mockResolvedValue({ ...revision, lifecycle: 'LOCKED' });
    vi.mocked(api.categories).mockResolvedValue(categories);
    vi.mocked(api.category).mockResolvedValue(detail);
    renderIsolated(<CategoryDetailPage />);

    expect(await screen.findByText('Hanya Baca')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pindahkan' })).not.toBeInTheDocument();
  });
});

describe('CategoryDetailPage — UX slice 0 (visual foundation + workspace)', () => {
  it('never shows a raw lifecycle enum value — only the translated label', async () => {
    setupHappyPath();
    renderIsolated(<CategoryDetailPage />);
    expect((await screen.findAllByText('Draf')).length).toBeGreaterThan(0);
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument();
    expect(screen.queryByText('REVIEW')).not.toBeInTheDocument();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  it('never shows a raw GREEN/YELLOW/RED quality value — only the translated badge text', async () => {
    setupHappyPath();
    renderIsolated(<CategoryDetailPage />);
    expect((await screen.findAllByText('Aman')).length).toBeGreaterThan(0);
    expect(screen.queryByText('GREEN')).not.toBeInTheDocument();
    expect(screen.queryByText('YELLOW')).not.toBeInTheDocument();
    expect(screen.queryByText('RED')).not.toBeInTheDocument();
  });

  it('the participant inspector is closed by default', async () => {
    setupHappyPath();
    renderIsolated(<CategoryDetailPage />);
    await screen.findAllByText('Draf');
    expect(screen.queryByRole('dialog', { name: /Detail Peserta/ })).not.toBeInTheDocument();
  });

  it('selecting a participant opens the inspector; closing it restores the workspace', async () => {
    setupHappyPath();
    renderIsolated(<CategoryDetailPage />);
    fireEvent.click(await screen.findByRole('group', { name: /budi/i }));

    const dialog = await screen.findByRole('dialog', { name: /Detail Peserta: Budi/ });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog', { name: /Detail Peserta/ })).not.toBeInTheDocument();
  });

  it('exposes "Tukar Peserta" for the SwapEntries command, never the raw word "Swap"', async () => {
    setupHappyPath();
    renderIsolated(<CategoryDetailPage />);
    expect((await screen.findAllByRole('button', { name: 'Tukar Peserta' }))[0]).toBeInTheDocument();
    expect(screen.queryByText(/\bSwap\b/)).not.toBeInTheDocument();
  });
});
