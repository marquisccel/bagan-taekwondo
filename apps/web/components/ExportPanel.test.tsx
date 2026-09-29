import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiClientError, downloadExportFile, type ExportArtifact } from '../lib/api';
import type * as ApiModule from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';
import { ExportPanel } from './ExportPanel';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    api: { requestExport: vi.fn(), getExport: vi.fn() },
    downloadExportFile: vi.fn(),
  };
});
vi.mock('../lib/dev-auth', () => ({ useDevAuth: vi.fn() }));

function renderIsolated(ui: React.ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

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

const exportRow = (overrides: Partial<ExportArtifact> = {}): ExportArtifact => ({
  id: 'e1',
  tournamentId: 't1',
  revisionId: 'r1',
  revisionNo: 1,
  exportType: 'TOURNAMENT_DRAW_BOOK',
  format: 'PDF',
  mode: 'PREVIEW',
  scopeType: 'REVISION',
  categoryId: null,
  poolId: null,
  status: 'REQUESTED',
  sourceFingerprint: 'sha256:s',
  parametersFingerprint: 'sha256:p',
  outputFingerprint: null,
  fileSha256: null,
  filename: null,
  sizeBytes: null,
  errorCode: null,
  requestedAt: new Date().toISOString(),
  generatedAt: null,
  ...overrides,
});

describe('ExportPanel', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders nothing for an unresolved actor (role null)', () => {
    mockAuth(null);
    const { container } = renderIsolated(
      <ExportPanel revisionId="r1" revisionLifecycle="LOCKED" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('requests an export with the selected type, defaulting to OFFICIAL once the revision is LOCKED+', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(exportRow());
    renderIsolated(
      <ExportPanel
        revisionId="r1"
        revisionLifecycle="LOCKED"
        availableTypes={['TOURNAMENT_DRAW_BOOK', 'XLSX_WORKBOOK']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() =>
      expect(api.requestExport).toHaveBeenCalledWith('actor-1', 'r1', {
        exportType: 'TOURNAMENT_DRAW_BOOK',
        mode: 'OFFICIAL',
        categoryId: undefined,
        poolId: undefined,
      }),
    );
  });

  it('offers the compact semi-prestasi sheet with its Indonesian label and requests it revision-wide, always as the official document', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(
      exportRow({ exportType: 'SEMI_PRESTASI_COMPACT_DRAW_SHEET' }),
    );
    renderIsolated(
      <ExportPanel
        revisionId="r1"
        revisionLifecycle="LOCKED"
        availableTypes={['TOURNAMENT_DRAW_BOOK', 'SEMI_PRESTASI_COMPACT_DRAW_SHEET']}
      />,
    );
    expect(screen.getByRole('option', { name: 'Lembar Bagan Arena/Hari Ini (PDF)' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Status resmi')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Jenis ekspor'), {
      target: { value: 'SEMI_PRESTASI_COMPACT_DRAW_SHEET' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() =>
      expect(api.requestExport).toHaveBeenCalledWith('actor-1', 'r1', {
        exportType: 'SEMI_PRESTASI_COMPACT_DRAW_SHEET',
        mode: 'OFFICIAL',
        categoryId: undefined,
        poolId: undefined,
      }),
    );
  });

  it('requests the compact semi-prestasi sheet for one category when a categoryId is given', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(
      exportRow({ exportType: 'SEMI_PRESTASI_COMPACT_DRAW_SHEET', scopeType: 'CATEGORY', categoryId: 'c1' }),
    );
    renderIsolated(
      <ExportPanel
        revisionId="r1"
        revisionLifecycle="LOCKED"
        availableTypes={['SEMI_PRESTASI_COMPACT_DRAW_SHEET']}
        categoryId="c1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() =>
      expect(api.requestExport).toHaveBeenCalledWith('actor-1', 'r1', {
        exportType: 'SEMI_PRESTASI_COMPACT_DRAW_SHEET',
        mode: 'OFFICIAL',
        categoryId: 'c1',
        poolId: undefined,
      }),
    );
  });

  it('requests PREVIEW (never OFFICIAL) while the revision is still DRAFT -- the backend refuses OFFICIAL before LOCKED, and Cek & Atur Bagan is used exactly while DRAFT', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(exportRow({ mode: 'PREVIEW' }));
    renderIsolated(
      <ExportPanel revisionId="r1" revisionLifecycle="DRAFT" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() =>
      expect(api.requestExport).toHaveBeenCalledWith('actor-1', 'r1', {
        exportType: 'TOURNAMENT_DRAW_BOOK',
        mode: 'PREVIEW',
        categoryId: undefined,
        poolId: undefined,
      }),
    );
  });

  it('shows a safe Indonesian message on EXPORT_UNAUTHORIZED, not the raw backend text', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockRejectedValue(
      new ApiClientError(403, 'EXPORT_UNAUTHORIZED', 'role DRAWING_OFFICER cannot request OFFICIAL'),
    );
    renderIsolated(
      <ExportPanel revisionId="r1" revisionLifecycle="LOCKED" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anda tidak memiliki izin');
  });

  it('downloads the file automatically once the export is READY -- no history list, no separate "Unduh" click', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(exportRow({ id: 'e1', status: 'REQUESTED' }));
    const ready = exportRow({ id: 'e1', status: 'READY', filename: 'x.pdf' });
    // Resolves READY on the very first poll (the immediate one the effect fires on mount) so this
    // test never depends on the interval's real-time delay.
    vi.mocked(api.getExport).mockResolvedValue(ready);
    renderIsolated(
      <ExportPanel revisionId="r1" revisionLifecycle="LOCKED" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() => expect(downloadExportFile).toHaveBeenCalledWith('actor-1', ready));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Buat Ekspor' })).not.toBeDisabled();
  });

  it('shows a friendly error and stops polling when the export ends up FAILED', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.requestExport).mockResolvedValue(exportRow({ id: 'e1', status: 'REQUESTED' }));
    vi.mocked(api.getExport).mockResolvedValue(
      exportRow({ id: 'e1', status: 'FAILED', errorCode: 'EXPORT_GENERATION_FAILED' }),
    );
    renderIsolated(
      <ExportPanel revisionId="r1" revisionLifecycle="LOCKED" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(downloadExportFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Buat Ekspor' })).not.toBeDisabled();
  });
});
