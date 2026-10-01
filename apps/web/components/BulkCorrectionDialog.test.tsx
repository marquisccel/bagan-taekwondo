import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { api, type EntryList, type EntryListItem } from '../lib/api';
import { BulkCorrectionDialog } from './BulkCorrectionDialog';

vi.mock('../lib/api', () => ({
  api: { entries: vi.fn(), correctEntry: vi.fn(), ruleSetVocabulary: vi.fn() },
  ApiClientError: class extends Error {},
}));

const renderIsolated = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const entry = (over: Partial<EntryListItem> = {}): EntryListItem => ({
  entryId: 'e1',
  externalRef: 'REG001',
  contingent: 'Kota Uji 1',
  displayName: 'Budi Santoso',
  format: 'INDIVIDUAL',
  members: [
    {
      position: 1,
      fullName: 'Budi Santoso',
      gender: 'MALE',
      beltCode: 'GEUP_9',
      beltLabel: 'Geup 9 (kuning)',
      heightMm: null,
      weightG: null,
      birthDate: null,
    },
  ],
  declared: {
    stream: 'SEMI_PRESTASI',
    discipline: 'KYORUGI',
    format: 'INDIVIDUAL',
    ageDivision: 'CADET',
    weightClass: '-41',
  },
  category: { id: 'c1', displayName: 'Kyorugi Semi Prestasi — Cadet Putra — -41 kg' },
  registrationStatus: 'REGISTERED',
  eligibilityStatus: 'READY',
  eligibilityReasons: [],
  group: null,
  issues: [],
  openIssueCounts: { error: 0, warning: 1, info: 0 },
  ...over,
});

/** `entry()` plus keeping displayName and members[0].fullName in sync -- most tests only care about
 * telling two entries apart by name, not the display/member-name distinction itself. */
const named = (entryId: string, fullName: string, over: Partial<EntryListItem> = {}): EntryListItem =>
  entry({
    entryId,
    displayName: fullName,
    members: [{ ...entry().members[0]!, fullName }],
    ...over,
  });

const list = (items: EntryListItem[], over: Partial<EntryList> = {}): EntryList => ({
  items,
  total: items.length,
  limit: 200,
  offset: 0,
  facets: { categories: [] },
  ...over,
});

describe('BulkCorrectionDialog', () => {
  it('steps through every entry needing review, saving one and skipping the next, then shows a summary', async () => {
    const entryA = named('a', 'Ani Wijaya');
    const entryB = named('b', 'Budi Santoso');
    vi.mocked(api.entries).mockResolvedValue(list([entryA, entryB]));
    vi.mocked(api.correctEntry).mockResolvedValue({ ok: true });
    vi.mocked(api.ruleSetVocabulary).mockResolvedValue({
      belts: [],
      ageDivisions: [],
      weightClassTables: [],
    });

    const onProgress = vi.fn();
    const onClose = vi.fn();
    renderIsolated(
      <BulkCorrectionDialog tournamentId="t1" actorId="actor-1" onClose={onClose} onProgress={onProgress} />,
    );

    const first = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });
    expect(within(first).getByText(/peserta 1 dari 2/i)).toBeInTheDocument();
    expect(within(first).getByDisplayValue('Ani Wijaya')).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(api.correctEntry).toHaveBeenCalledWith('actor-1', 't1', 'a', expect.anything()),
    );
    expect(onProgress).toHaveBeenCalled();

    const second = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });
    expect(within(second).getByText(/peserta 2 dari 2/i)).toBeInTheDocument();
    expect(within(second).getByDisplayValue('Budi Santoso')).toBeInTheDocument();

    fireEvent.click(within(second).getByRole('button', { name: 'Lewati' }));

    expect(await screen.findByText(/1 dari 2 peserta diperbaiki, 1 dilewati/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing mid-walkthrough keeps whatever was already saved -- no rollback, just stop', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    const onClose = vi.fn();
    renderIsolated(
      <BulkCorrectionDialog tournamentId="t1" actorId="actor-1" onClose={onClose} onProgress={vi.fn()} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows nothing left to review as an immediate, friendly summary', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([]));
    renderIsolated(
      <BulkCorrectionDialog tournamentId="t1" actorId="actor-1" onClose={vi.fn()} onProgress={vi.fn()} />,
    );
    expect(await screen.findByText(/0 dari 0 peserta diperbaiki/i)).toBeInTheDocument();
  });
});
