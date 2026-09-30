import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { previewSps, uploadSps, type SpsUploadPreview, type SpsUploadResult } from '../lib/api';
import HomePage from './page';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('../lib/api', () => ({ previewSps: vi.fn(), uploadSps: vi.fn() }));

const setTournament = vi.fn();
const setActor = vi.fn();
vi.mock('../lib/dev-auth', () => ({
  useDevAuth: vi.fn(() => ({ tournamentId: '', actorId: '', setTournament, setActor })),
}));

const file = new File(['dummy'], 'sps.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

const preview = (over: Partial<SpsUploadPreview> = {}): SpsUploadPreview => ({
  ok: true,
  blockers: [],
  tournamentName: 'Piala Gubernur Jawa Timur 2026',
  jadwalSheet: 'Jadwal FIX',
  participantSheet: 'semi-prestasi',
  eventStart: '2026-09-18',
  eventEnd: '2026-09-20',
  arenaCodes: ['A', 'B', 'C'],
  scheduleRowCount: 120,
  scheduleIssues: [],
  participantCount: 534,
  categoryCount: 56,
  participantIssueCounts: { error: 0, warning: 0, info: 0 },
  ...over,
});

const uploadResult = (): SpsUploadResult => ({
  tournamentId: 't1',
  tournamentCode: 'T20260918-abc123',
  actorId: 'actor-1',
  ruleSetId: 'rs1',
  intakeSnapshotId: 'snap1',
  participantCount: 534,
  scheduleRowCount: 120,
  arenaCodes: ['A', 'B', 'C'],
  eventStart: '2026-09-18',
  eventEnd: '2026-09-20',
  scheduleIssues: [],
});

const dropFile = () => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

describe('HomePage (SPS upload)', () => {
  beforeEach(() => {
    vi.mocked(previewSps).mockReset();
    vi.mocked(uploadSps).mockReset();
    push.mockReset();
    setTournament.mockReset();
    setActor.mockReset();
  });

  it('previews a picked file and shows its summary, without creating anything yet', async () => {
    vi.mocked(previewSps).mockResolvedValue(preview());
    render(<HomePage />);

    dropFile();

    const panel = await screen.findByTestId('sps-preview');
    expect(panel).toHaveTextContent('Piala Gubernur Jawa Timur 2026');
    expect(panel).toHaveTextContent('534 peserta');
    expect(panel).toHaveTextContent('56 kategori');
    expect(panel).toHaveTextContent('120 baris jadwal');
    expect(panel).toHaveTextContent('3 arena');
    expect(uploadSps).not.toHaveBeenCalled();
  });

  it('only commits (creates the tournament) once Lanjutkan is pressed, using the same file', async () => {
    vi.mocked(previewSps).mockResolvedValue(preview());
    vi.mocked(uploadSps).mockResolvedValue(uploadResult());
    render(<HomePage />);

    dropFile();
    await screen.findByTestId('sps-preview');
    expect(uploadSps).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /lanjutkan & buat turnamen/i }));

    await waitFor(() => expect(uploadSps).toHaveBeenCalledTimes(1));
    const [, uploadedFile] = vi.mocked(uploadSps).mock.calls[0] as [string, File];
    expect(uploadedFile).toBe(file);
    await waitFor(() => expect(setTournament).toHaveBeenCalledWith('T20260918-abc123'));
    expect(setActor).toHaveBeenCalledWith('actor-1');
  });

  it('disables committing and lists every blocker when the preview cannot proceed', async () => {
    vi.mocked(previewSps).mockResolvedValue(
      preview({
        ok: false,
        blockers: ['Tab "Jadwal FIX" tidak menghasilkan satu pun baris jadwal yang bisa dibaca.'],
        scheduleRowCount: 0,
        arenaCodes: [],
      }),
    );
    render(<HomePage />);

    dropFile();
    await screen.findByTestId('sps-preview');

    expect(screen.getByText(/tidak menghasilkan satu pun baris jadwal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lanjutkan & buat turnamen/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /pilih file lain/i }));
    expect(screen.queryByTestId('sps-preview')).not.toBeInTheDocument();
    expect(uploadSps).not.toHaveBeenCalled();
  });

  it('shows a preview failure without ever committing', async () => {
    vi.mocked(previewSps).mockRejectedValue(new Error('server down'));
    render(<HomePage />);

    dropFile();

    expect(await screen.findByText(/gagal: server down/i)).toBeInTheDocument();
    expect(uploadSps).not.toHaveBeenCalled();
  });
});
