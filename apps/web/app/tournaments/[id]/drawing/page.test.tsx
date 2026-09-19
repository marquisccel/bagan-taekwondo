import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, api, type DrawPreflight, type DrawRun } from '../../../../lib/api';
import DrawingPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }) }));
vi.mock('../../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { drawPreflight: vi.fn(), createDrawRun: vi.fn(), drawRun: vi.fn() } };
});
vi.mock('../../../../lib/dev-auth', () => ({ useDevAuth: vi.fn(() => ({ actorId: 'actor-1' })) }));

const renderIsolated = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const preflight = (over: Partial<DrawPreflight> = {}): DrawPreflight => ({
  tournament: { id: 't1', code: 'PG-2026', name: 'Piala Gubernur' },
  role: 'DRAWING_OFFICER',
  canRequest: true,
  ruleSet: { id: 'rs1', code: 'PG', version: 3, name: 'Aturan Piala Gubernur', status: 'ACTIVE' },
  ruleSetLock: {
    lockable: false,
    requiresAcknowledgement: false,
    blockerCount: 4,
    warningCount: 2,
    findings: [
      { code: 'RULE_SET_NOT_ACTIVE', level: 'LOCK_BLOCKER', count: 1 },
      { code: 'MAX_TOLERANCE_UNSET', level: 'LOCK_BLOCKER', count: 3 },
      { code: 'RULE_NOT_COMMITTEE_CONFIRMED', level: 'LOCK_WARNING', count: 2 },
    ],
  },
  intakeSnapshot: { id: 'snap1', entryCount: 30, createdAt: '2026-08-01T10:00:00.000Z' },
  entries: { total: 30, eligible: 24, blocked: 6 },
  openIssues: { error: 5, warning: 7, info: 1 },
  blockers: [],
  ...over,
});

const run = (over: Partial<DrawRun> = {}): DrawRun => ({
  id: 'run-1',
  tournament_id: 't1',
  rule_set_id: 'rs1',
  kind: 'CANDIDATE',
  status: 'QUEUED',
  seed: '20260827',
  engine_version: 'v',
  rules_fingerprint: 'r',
  input_fingerprint: 'i',
  output_fingerprint: null,
  scope: [],
  unsafe_reasons: [],
  dual_run_match: null,
  duration_ms: null,
  requested_by: 'actor-1',
  requested_at: '2026-08-01T10:00:00.000Z',
  started_at: null,
  finished_at: null,
  ...over,
});

async function startDraw() {
  fireEvent.click(await screen.findByRole('button', { name: 'Buat Drawing' }));
  const dialog = screen.getByRole('dialog', { name: 'Konfirmasi Buat Drawing' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Konfirmasi dan jalankan' }));
}

describe('DrawingPage', () => {
  beforeEach(() => {
    vi.mocked(api.drawPreflight).mockReset();
    vi.mocked(api.createDrawRun).mockReset();
    vi.mocked(api.drawRun).mockReset();
    vi.mocked(api.drawPreflight).mockResolvedValue(preflight());
  });

  it('shows real pre-flight context: rule set, eligible/blocked counts, issues and the provisional status', async () => {
    renderIsolated(<DrawingPage />);
    const pf = within(await screen.findByTestId('draw-preflight'));
    expect(pf.getByTestId('preflight-eligible')).toHaveTextContent('24');
    expect(pf.getByTestId('preflight-blocked')).toHaveTextContent('6');
    expect(pf.getByTestId('preflight-issues')).toHaveTextContent('12');
    expect(pf.getByTestId('preflight-ruleset')).toHaveTextContent(/Aturan Piala Gubernur.*PG.*v3.*Aktif/);
    expect(pf.getByTestId('preflight-lock-status')).toHaveTextContent(/Provisional/);
    expect(pf.getByTestId('preflight-lock-status')).toHaveTextContent('4 hal penghalang');
    const findings = pf.getByRole('list', { name: 'Temuan set aturan' });
    expect(within(findings).getByText(/belum berstatus aktif/)).toBeInTheDocument();
    expect(within(findings).getByText('MAX_TOLERANCE_UNSET')).toBeInTheDocument();
    expect(pf.getByText(/30 entri/)).toBeInTheDocument();
  });

  it('confirms first, then requests the draw with the pre-flight rule set + snapshot, and never before confirmation', async () => {
    vi.mocked(api.createDrawRun).mockResolvedValue({
      drawRunId: 'run-1',
      inputFingerprint: 'x',
      status: 'QUEUED',
    });
    vi.mocked(api.drawRun).mockResolvedValue(run());
    renderIsolated(<DrawingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Buat Drawing' }));
    expect(api.createDrawRun).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Konfirmasi Buat Drawing' });
    expect(dialog).toHaveTextContent('24');
    expect(dialog).toHaveTextContent(/provisional/i);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.createDrawRun).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '424242' } });
    await startDraw();
    await waitFor(() =>
      expect(api.createDrawRun).toHaveBeenCalledWith('actor-1', 't1', {
        ruleSetId: 'rs1',
        intakeSnapshotId: 'snap1',
        kind: 'CANDIDATE',
        seed: '424242',
        scope: [],
      }),
    );
    const status = await screen.findByTestId('draw-run-status');
    expect(within(status).getByTestId('draw-run-status-badge')).toHaveTextContent('Dalam antrean');
    expect(api.drawRun).toHaveBeenCalledWith('actor-1', 'run-1');
    // Cannot double-submit while the run is in progress.
    expect(screen.getByRole('button', { name: 'Buat Drawing' })).toBeDisabled();
  });

  it('polls the real status: QUEUED -> RUNNING -> SAFE, then offers the draw workspace', async () => {
    vi.mocked(api.createDrawRun).mockResolvedValue({
      drawRunId: 'run-1',
      inputFingerprint: 'x',
      status: 'QUEUED',
    });
    vi.mocked(api.drawRun)
      .mockResolvedValueOnce(run({ status: 'QUEUED' }))
      .mockResolvedValueOnce(run({ status: 'RUNNING' }))
      .mockResolvedValue(run({ status: 'SAFE' }));
    renderIsolated(<DrawingPage />);
    await startDraw();
    const badge = () => screen.getByTestId('draw-run-status-badge');
    await waitFor(() => expect(badge()).toHaveTextContent('Dalam antrean'));
    await waitFor(() => expect(badge()).toHaveTextContent('Sedang diproses'), { timeout: 6000 });
    await waitFor(() => expect(badge()).toHaveTextContent('Aman'), { timeout: 6000 });
    expect(screen.getByRole('link', { name: 'Buka ruang kerja drawing' })).toHaveAttribute(
      'href',
      '/tournaments/t1/categories',
    );
    expect(screen.getByRole('link', { name: 'Detail draw run' })).toHaveAttribute(
      'href',
      '/tournaments/t1/draws/run-1',
    );
  }, 20_000);

  it('shows backend-provided UNSAFE reasons as Indonesian text plus the code', async () => {
    vi.mocked(api.createDrawRun).mockResolvedValue({
      drawRunId: 'run-1',
      inputFingerprint: 'x',
      status: 'QUEUED',
    });
    vi.mocked(api.drawRun).mockResolvedValue(
      run({
        status: 'UNSAFE',
        unsafe_reasons: [
          { code: 'CATEGORY_BLOCKED', params: { categories: 2 } },
          { code: 'SOMETHING_NEW', params: {} },
        ],
      }),
    );
    renderIsolated(<DrawingPage />);
    await startDraw();
    const status = within(await screen.findByTestId('draw-run-status'));
    await waitFor(() => expect(status.getByTestId('draw-run-status-badge')).toHaveTextContent('Tidak aman'));
    expect(status.getByRole('alert')).toHaveTextContent(/TIDAK AMAN/);
    const reasons = status.getByRole('list', { name: 'Alasan dari sistem' });
    expect(within(reasons).getByText(/Ada kategori yang diblokir/)).toBeInTheDocument();
    expect(within(reasons).getByText('CATEGORY_BLOCKED')).toBeInTheDocument();
    expect(within(reasons).getByText('SOMETHING_NEW')).toBeInTheDocument();
    expect(status.queryByRole('link', { name: 'Buka ruang kerja drawing' })).not.toBeInTheDocument();
  });

  it('shows FAILED with the worker reason code', async () => {
    vi.mocked(api.createDrawRun).mockResolvedValue({
      drawRunId: 'run-1',
      inputFingerprint: 'x',
      status: 'QUEUED',
    });
    vi.mocked(api.drawRun).mockResolvedValue(
      run({ status: 'FAILED', unsafe_reasons: [{ code: 'WORKER_TIMEOUT', params: { reason: 'stuck' } }] }),
    );
    renderIsolated(<DrawingPage />);
    await startDraw();
    const status = within(await screen.findByTestId('draw-run-status'));
    await waitFor(() => expect(status.getByTestId('draw-run-status-badge')).toHaveTextContent('Gagal'));
    expect(status.getByText('WORKER_TIMEOUT')).toBeInTheDocument();
    expect(status.getByText(/Rincian teknis/)).toBeInTheDocument();
  });

  it('shows a clear Indonesian message on 403 FORBIDDEN_COMMAND', async () => {
    vi.mocked(api.createDrawRun).mockRejectedValue(
      new ApiClientError(403, 'FORBIDDEN_COMMAND', 'role VIEWER may not create draw runs'),
    );
    renderIsolated(<DrawingPage />);
    await startDraw();
    expect(await screen.findByTestId('draw-submit-error')).toHaveTextContent(
      /tidak memiliki izin untuk membuat drawing/i,
    );
    expect(screen.queryByTestId('draw-run-status')).not.toBeInTheDocument();
  });

  it('disables the action for a VIEWER and explains why', async () => {
    vi.mocked(api.drawPreflight).mockResolvedValue(preflight({ role: 'VIEWER', canRequest: false }));
    renderIsolated(<DrawingPage />);
    expect(await screen.findByTestId('draw-forbidden')).toHaveTextContent(/tidak memiliki izin/i);
    expect(screen.getByRole('button', { name: 'Buat Drawing' })).toBeDisabled();
  });

  it('disables the action and says why when there is no ACTIVE rule set or intake snapshot', async () => {
    vi.mocked(api.drawPreflight).mockResolvedValue(
      preflight({ ruleSet: null, ruleSetLock: null, intakeSnapshot: null, blockers: ['NO_ACTIVE_RULE_SET'] }),
    );
    renderIsolated(<DrawingPage />);
    expect(await screen.findByText(/belum ada set aturan aktif/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat Drawing' })).toBeDisabled();
  });

  it('rejects an invalid seed before calling the API', async () => {
    renderIsolated(<DrawingPage />);
    await screen.findByRole('button', { name: 'Buat Drawing' });
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '007' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/seed harus berupa bilangan bulat/i);
    expect(screen.getByRole('button', { name: 'Buat Drawing' })).toBeDisabled();
  });

  it('can request a simulation instead of a candidate', async () => {
    vi.mocked(api.createDrawRun).mockResolvedValue({
      drawRunId: 'run-1',
      inputFingerprint: 'x',
      status: 'QUEUED',
    });
    vi.mocked(api.drawRun).mockResolvedValue(run({ kind: 'SIMULATION' }));
    renderIsolated(<DrawingPage />);
    fireEvent.change(await screen.findByLabelText('Jenis drawing'), { target: { value: 'SIMULATION' } });
    await startDraw();
    await waitFor(() =>
      expect(api.createDrawRun).toHaveBeenCalledWith(
        'actor-1',
        't1',
        expect.objectContaining({ kind: 'SIMULATION' }),
      ),
    );
  });
});
