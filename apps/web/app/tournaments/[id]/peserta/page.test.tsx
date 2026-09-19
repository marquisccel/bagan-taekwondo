import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type EntryList, type EntryListItem } from '../../../../lib/api';
import PesertaPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }) }));
vi.mock('../../../../lib/api', () => ({ api: { entries: vi.fn() } }));
vi.mock('../../../../lib/dev-auth', () => ({ useDevAuth: vi.fn(() => ({ actorId: 'actor-1' })) }));

const renderIsolated = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const entry = (over: Partial<EntryListItem> = {}): EntryListItem => ({
  entryId: 'e1',
  externalRef: 'REG001',
  contingent: 'Kota Uji 1',
  displayName: 'Budi Santoso',
  format: 'INDIVIDUAL',
  members: [{ position: 1, fullName: 'Budi Santoso', gender: 'MALE', beltCode: 'GEUP_9' }],
  declared: {
    stream: 'SEMI_PRESTASI',
    discipline: 'KYORUGI',
    format: 'INDIVIDUAL',
    ageDivision: 'CADET',
    weightClass: '-41',
  },
  category: {
    id: 'c1',
    displayName: 'Kyorugi Semi Prestasi — Cadet Putra — -41 kg',
  },
  registrationStatus: 'REGISTERED',
  eligibilityStatus: 'READY',
  eligibilityReasons: [],
  group: null,
  issues: [],
  openIssueCounts: { error: 0, warning: 0, info: 0 },
  ...over,
});

const list = (items: EntryListItem[], over: Partial<EntryList> = {}): EntryList => ({
  items,
  total: items.length,
  limit: 50,
  offset: 0,
  facets: { categories: [{ id: 'c1', displayName: 'Kyorugi Semi Prestasi — Cadet Putra — -41 kg' }] },
  ...over,
});

describe('PesertaPage', () => {
  beforeEach(() => {
    vi.mocked(api.entries).mockReset();
  });

  it('shows a participant with readable category, eligibility and no raw category key', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    const row = await screen.findByTestId('entry-row');
    const r = within(row);
    expect(r.getByText('Budi Santoso')).toBeInTheDocument();
    expect(r.getByText('Kota Uji 1')).toBeInTheDocument();
    expect(r.getByTestId('entry-category')).toHaveTextContent('Kyorugi Semi Prestasi — Cadet Putra — -41 kg');
    expect(r.getByText('Siap')).toBeInTheDocument();
    expect(r.getByText('Tidak ada')).toBeInTheDocument();
    expect(screen.getByTestId('entry-range')).toHaveTextContent('Menampilkan 1–1 dari 1 peserta');
    expect(screen.queryByTestId('entry-format-badge')).not.toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\|/);
  });

  it('shows Pair/Team identity: all member names joined, a Pasangan/Beregu label and group provenance', async () => {
    vi.mocked(api.entries).mockResolvedValue(
      list([
        entry({
          entryId: 'e2',
          displayName: 'Ani Wijaya / Budi Santoso',
          format: 'PAIR',
          members: [
            { position: 1, fullName: 'Ani Wijaya', gender: 'FEMALE', beltCode: null },
            { position: 2, fullName: 'Budi Santoso', gender: 'MALE', beltCode: null },
          ],
          declared: {
            stream: 'PRESTASI',
            discipline: 'POOMSAE',
            format: 'PAIR',
            ageDivision: 'DEWASA',
            weightClass: null,
          },
          category: null,
          group: { source: 'HEURISTIC', status: 'PROPOSED', confidence: 'LOW' },
        }),
        entry({
          entryId: 'e3',
          displayName: 'A / B / C',
          format: 'TEAM',
          members: [
            { position: 1, fullName: 'A', gender: 'MALE', beltCode: null },
            { position: 2, fullName: 'B', gender: 'MALE', beltCode: null },
            { position: 3, fullName: 'C', gender: 'MALE', beltCode: null },
          ],
          group: { source: 'EXPLICIT', status: 'CONFIRMED', confidence: 'HIGH' },
        }),
      ]),
    );
    renderIsolated(<PesertaPage />);
    const rows = await screen.findAllByTestId('entry-row');
    const pair = within(rows[0] as HTMLElement);
    expect(pair.getByText('Ani Wijaya / Budi Santoso')).toBeInTheDocument();
    expect(pair.getByTestId('entry-format-badge')).toHaveTextContent('Pasangan');
    expect(pair.getByText(/2 anggota/)).toBeInTheDocument();
    expect(
      pair.getByText(/Pengelompokan: Diusulkan \(Dugaan sistem, keyakinan rendah\)/),
    ).toBeInTheDocument();
    expect(pair.getByTestId('entry-category')).toHaveTextContent('Belum ditetapkan');
    const team = within(rows[1] as HTMLElement);
    expect(team.getByTestId('entry-format-badge')).toHaveTextContent('Beregu');
    expect(team.getByText('A / B / C')).toBeInTheDocument();
  });

  it('shows blocked eligibility with persisted reasons and the validation issues', async () => {
    vi.mocked(api.entries).mockResolvedValue(
      list([
        entry({
          eligibilityStatus: 'BLOCKED',
          eligibilityReasons: ['WEIGHT_OUT_OF_RANGE', 'BRAND_NEW_CODE'],
          issues: [
            {
              id: 'i1',
              code: 'WEIGHT_OUT_OF_RANGE',
              severity: 'ERROR',
              status: 'OPEN',
              field: 'weight',
              subjectType: 'ATHLETE',
            },
            {
              id: 'i2',
              code: 'NAME_WHITESPACE',
              severity: 'WARNING',
              status: 'ACKNOWLEDGED',
              field: 'name',
              subjectType: 'IMPORT_ROW',
            },
          ],
          openIssueCounts: { error: 1, warning: 0, info: 0 },
        }),
      ]),
    );
    renderIsolated(<PesertaPage />);
    const row = within(await screen.findByTestId('entry-row'));
    expect(row.getByText('Diblokir')).toBeInTheDocument();
    const reasons = row.getByRole('list', { name: 'Alasan diblokir' });
    expect(within(reasons).getByText(/Berat badan di luar batas wajar/)).toBeInTheDocument();
    expect(within(reasons).getByText('BRAND_NEW_CODE')).toBeInTheDocument();
    expect(row.getByText('1 kesalahan')).toBeInTheDocument();
    expect(row.getByText(/Kesalahan/, { selector: 'strong' })).toBeInTheDocument();
    expect(row.getByText(/Diakui/)).toBeInTheDocument();
  });

  it('applies the search, contingent, discipline, category, eligibility and issue filters to the API query', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');

    fireEvent.change(screen.getByLabelText('Cari peserta'), { target: { value: ' budi ' } });
    fireEvent.change(screen.getByLabelText('Cari kontingen'), { target: { value: 'Kota' } });
    fireEvent.change(screen.getByLabelText('Disiplin'), { target: { value: 'KYORUGI' } });
    fireEvent.change(screen.getByLabelText('Kategori'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Kelayakan'), { target: { value: 'BLOCKED' } });
    fireEvent.click(screen.getByLabelText('Hanya yang bermasalah'));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));

    await waitFor(() =>
      expect(api.entries).toHaveBeenLastCalledWith('actor-1', 't1', {
        q: 'budi',
        contingent: 'Kota',
        discipline: 'KYORUGI',
        categoryId: 'c1',
        eligibility: 'BLOCKED',
        hasIssues: true,
        limit: 50,
        offset: 0,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Atur ulang' }));
    await waitFor(() =>
      expect(api.entries).toHaveBeenLastCalledWith(
        'actor-1',
        't1',
        expect.objectContaining({ q: '', discipline: '', hasIssues: undefined, offset: 0 }),
      ),
    );
  });

  it('offers the categories present in the data as a filter, including "Belum ditetapkan"', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');
    const select = screen.getByLabelText('Kategori');
    expect(within(select).getByRole('option', { name: 'Belum ditetapkan' })).toBeInTheDocument();
    expect(
      within(select).getByRole('option', { name: 'Kyorugi Semi Prestasi — Cadet Putra — -41 kg' }),
    ).toBeInTheDocument();
  });

  it('paginates with Sebelumnya/Berikutnya', async () => {
    vi.mocked(api.entries).mockImplementation((_a, _t, params) =>
      Promise.resolve(list([entry()], { total: 120, offset: params?.offset ?? 0 })),
    );
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');
    expect(screen.getByTestId('entry-range')).toHaveTextContent('Menampilkan 1–50 dari 120 peserta');
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(screen.getByTestId('entry-range')).toHaveTextContent('Menampilkan 51–100 dari 120 peserta'),
    );
    expect(api.entries).toHaveBeenLastCalledWith('actor-1', 't1', expect.objectContaining({ offset: 50 }));
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(screen.getByTestId('entry-range')).toHaveTextContent('Menampilkan 101–120 dari 120 peserta'),
    );
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled();
  });

  it('shows an empty state and API errors in Indonesian', async () => {
    vi.mocked(api.entries).mockResolvedValueOnce(list([]));
    renderIsolated(<PesertaPage />);
    expect(await screen.findByTestId('entry-empty')).toHaveTextContent(/tidak ada peserta/i);
  });

  it('reports a load failure', async () => {
    vi.mocked(api.entries).mockRejectedValue(new Error('server down'));
    renderIsolated(<PesertaPage />);
    expect(await screen.findByText(/gagal memuat data peserta: server down/i)).toBeInTheDocument();
  });
});
