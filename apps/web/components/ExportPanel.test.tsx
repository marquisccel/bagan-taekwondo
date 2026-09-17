import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiClientError, type ExportArtifact } from '../lib/api';
import type * as ApiModule from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';
import { ExportPanel } from './ExportPanel';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    api: { requestExport: vi.fn(), listExports: vi.fn(), getExport: vi.fn() },
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
    vi.mocked(api.listExports).mockResolvedValue([]);
    const { container } = renderIsolated(
      <ExportPanel revisionId="r1" availableTypes={['TOURNAMENT_DRAW_BOOK']} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('requests an export with the selected type and mode', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.listExports).mockResolvedValue([]);
    vi.mocked(api.requestExport).mockResolvedValue(exportRow());
    renderIsolated(
      <ExportPanel revisionId="r1" availableTypes={['TOURNAMENT_DRAW_BOOK', 'XLSX_WORKBOOK']} />,
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
    vi.mocked(api.listExports).mockResolvedValue([]);
    vi.mocked(api.requestExport).mockRejectedValue(
      new ApiClientError(403, 'EXPORT_UNAUTHORIZED', 'role DRAWING_OFFICER cannot request OFFICIAL'),
    );
    renderIsolated(<ExportPanel revisionId="r1" availableTypes={['TOURNAMENT_DRAW_BOOK']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buat Ekspor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Anda tidak memiliki izin');
  });

  it('shows a download button only for a READY export in the history list', async () => {
    mockAuth('DRAWING_OFFICER');
    vi.mocked(api.listExports).mockResolvedValue([
      exportRow({ id: 'e-ready', status: 'READY', filename: 'x.pdf' }),
      exportRow({ id: 'e-failed', status: 'FAILED', errorCode: 'EXPORT_GENERATION_FAILED' }),
    ]);
    renderIsolated(<ExportPanel revisionId="r1" availableTypes={['TOURNAMENT_DRAW_BOOK']} />);

    expect(await screen.findByRole('button', { name: 'Unduh' })).toBeInTheDocument();
    expect(screen.getByText('EXPORT_GENERATION_FAILED')).toBeInTheDocument();
  });
});
