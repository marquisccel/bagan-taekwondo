import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type EntryList, type EntryListItem } from '../../../../lib/api';
import PesertaPage from './page';

const searchParamsOf = (query = ''): ReadonlyURLSearchParams =>
  new URLSearchParams(query) as unknown as ReadonlyURLSearchParams;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 't1' }),
  useSearchParams: vi.fn(() => new URLSearchParams() as unknown as ReadonlyURLSearchParams),
}));
vi.mock('../../../../lib/api', () => ({
  api: { entries: vi.fn(), correctEntry: vi.fn(), ruleSetVocabulary: vi.fn() },
  ApiClientError: class extends Error {},
}));
vi.mock('../../../../lib/dev-auth', () => ({ useDevAuth: vi.fn(() => ({ actorId: 'actor-1' })) }));

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
    vi.mocked(useSearchParams).mockReturnValue(searchParamsOf());
  });

  it('pre-applies the "perlu ditinjau" filter from a ?review=NEEDS_REVIEW deep link', async () => {
    vi.mocked(useSearchParams).mockReturnValue(searchParamsOf('review=NEEDS_REVIEW'));
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    await waitFor(() =>
      expect(api.entries).toHaveBeenCalledWith('actor-1', 't1', expect.objectContaining({ hasIssues: true })),
    );
  });

  it('shows a participant with ID, belt, and the SPS-style klasifikasi/divisi/class columns', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    const row = await screen.findByTestId('entry-row');
    const r = within(row);
    expect(r.getByText('REG001')).toBeInTheDocument();
    expect(r.getByText('Budi Santoso')).toBeInTheDocument();
    expect(r.getByText('Kota Uji 1')).toBeInTheDocument();
    expect(r.getByText('Geup 9 (kuning)')).toBeInTheDocument();
    expect(r.getByText('Kyorugi Semi Prestasi')).toBeInTheDocument();
    expect(r.getByText('Cadet')).toBeInTheDocument();
    expect(r.getByText('Under 41 kg')).toBeInTheDocument();
    expect(r.getByText('Tidak ada')).toBeInTheDocument();
    expect(r.getByRole('button', { name: 'Perbaiki data Budi Santoso' })).toBeInTheDocument();
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
            {
              position: 1,
              fullName: 'Ani Wijaya',
              gender: 'FEMALE',
              beltCode: null,
              beltLabel: null,
              heightMm: null,
              weightG: null,
              birthDate: null,
            },
            {
              position: 2,
              fullName: 'Budi Santoso',
              gender: 'MALE',
              beltCode: null,
              beltLabel: null,
              heightMm: null,
              weightG: null,
              birthDate: null,
            },
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
            {
              position: 1,
              fullName: 'A',
              gender: 'MALE',
              beltCode: null,
              beltLabel: null,
              heightMm: null,
              weightG: null,
              birthDate: null,
            },
            {
              position: 2,
              fullName: 'B',
              gender: 'MALE',
              beltCode: null,
              beltLabel: null,
              heightMm: null,
              weightG: null,
              birthDate: null,
            },
            {
              position: 3,
              fullName: 'C',
              gender: 'MALE',
              beltCode: null,
              beltLabel: null,
              heightMm: null,
              weightG: null,
              birthDate: null,
            },
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
    const team = within(rows[1] as HTMLElement);
    expect(team.getByTestId('entry-format-badge')).toHaveTextContent('Beregu');
    expect(team.getByText('A / B / C')).toBeInTheDocument();
  });

  it('shows the validation issues in plain Indonesian (no raw codes), and offers Perbaiki to fix them', async () => {
    vi.mocked(api.entries).mockResolvedValue(
      list([
        entry({
          eligibilityStatus: 'BLOCKED',
          eligibilityReasons: ['WEIGHT_OUT_OF_RANGE'],
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
    const rowEl = await screen.findByTestId('entry-row');
    const row = within(rowEl);
    const trigger = row.getByRole('button', { name: '1 kesalahan' });
    expect(row.getByRole('button', { name: 'Perbaiki data Budi Santoso' })).toBeInTheDocument();
    expect(rowEl.textContent).not.toMatch(/WEIGHT_OUT_OF_RANGE|NAME_WHITESPACE/);

    // The detail list opens as a popover (portaled to <body>), not inline -- so it never distorts the
    // row's own height, unlike the old <details>/<summary> expansion it replaced.
    expect(rowEl.querySelector('.issue-summary-popover')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByText(/Kesalahan/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Diakui/)).toBeInTheDocument();
    expect(rowEl.querySelector('.issue-summary-popover')).not.toBeInTheDocument();
  });

  it('shows a single issue directly, with no click needed to see what it is', async () => {
    vi.mocked(api.entries).mockResolvedValue(
      list([
        entry({
          issues: [
            {
              id: 'i1',
              code: 'NIK_INVALID_FORMAT',
              severity: 'WARNING',
              status: 'OPEN',
              field: 'nik',
              subjectType: 'ATHLETE',
            },
          ],
          openIssueCounts: { error: 0, warning: 1, info: 0 },
        }),
      ]),
    );
    renderIsolated(<PesertaPage />);
    const rowEl = await screen.findByTestId('entry-row');
    expect(within(rowEl).getByText(/Peringatan/, { selector: 'strong' })).toBeInTheDocument();
    // No button, no popover -- just the one issue's text, right in the cell.
    expect(within(rowEl).queryByRole('button', { name: /peringatan/i })).not.toBeInTheDocument();
    expect(rowEl.querySelector('.issue-summary-popover')).not.toBeInTheDocument();
  });

  it('applies the search, contingent, discipline, category, eligibility and review filters live, with no separate apply step', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');

    fireEvent.change(screen.getByLabelText('Cari peserta'), { target: { value: ' budi ' } });
    fireEvent.change(screen.getByLabelText('Cari kontingen'), { target: { value: 'Kota' } });
    fireEvent.change(screen.getByLabelText('Disiplin'), { target: { value: 'KYORUGI' } });
    fireEvent.change(screen.getByLabelText('Kategori'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Kelayakan'), { target: { value: 'BLOCKED' } });
    fireEvent.change(screen.getByLabelText('Status peninjauan'), { target: { value: 'NEEDS_REVIEW' } });

    await waitFor(
      () =>
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
      { timeout: 2000 },
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

  it('opens Perbaiki, edits a field, saves via correctEntry, and reloads the list', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    vi.mocked(api.correctEntry).mockResolvedValue({ ok: true });
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');

    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki data Budi Santoso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });
    fireEvent.change(within(dialog).getByLabelText('Berat Badan (kg)'), { target: { value: '45.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

    await waitFor(() =>
      expect(api.correctEntry).toHaveBeenCalledWith(
        'actor-1',
        't1',
        'e1',
        expect.objectContaining({ weightG: 45500 }),
      ),
    );
    await waitFor(() => expect(api.entries).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Perbaiki Data Peserta' })).not.toBeInTheDocument();
  });

  it('Sabuk/Divisi/Class in Perbaiki are dropdowns sourced from the rule set, and Class depends on the chosen Divisi', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    vi.mocked(api.correctEntry).mockResolvedValue({ ok: true });
    vi.mocked(api.ruleSetVocabulary).mockResolvedValue({
      belts: [
        { code: 'GEUP_9', rank: 1, label: 'Geup 9 (kuning)' },
        { code: 'GEUP_8', rank: 2, label: 'Geup 8 (kuning strip hijau)' },
      ],
      ageDivisions: [
        { code: 'CADET', label: 'Cadet', order: 4 },
        { code: 'JUNIOR', label: 'Junior', order: 5 },
      ],
      weightClassTables: [
        {
          stream: 'SEMI_PRESTASI',
          ageDivisionCode: 'CADET',
          gender: 'MALE',
          classes: [{ code: '-41' }, { code: '-45' }],
        },
        {
          stream: 'SEMI_PRESTASI',
          ageDivisionCode: 'JUNIOR',
          gender: 'MALE',
          classes: [{ code: '-48' }, { code: '-51' }],
        },
      ],
    });
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');

    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki data Budi Santoso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });

    const belt = await within(dialog).findByLabelText('Sabuk');
    expect(within(belt).getByRole('option', { name: 'Geup 9 (kuning)' })).toBeInTheDocument();
    expect((belt as HTMLSelectElement).value).toBe('GEUP_9');

    const classSelect = within(dialog).getByLabelText('Class / kelas berat');
    expect(within(classSelect).getByRole('option', { name: 'Under 41 kg' })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Divisi'), { target: { value: 'JUNIOR' } });
    await waitFor(() =>
      expect(within(classSelect).getByRole('option', { name: 'Under 48 kg' })).toBeInTheDocument(),
    );
    expect(within(classSelect).queryByRole('option', { name: 'Under 41 kg' })).not.toBeInTheDocument();
    fireEvent.change(classSelect, { target: { value: '-51' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(api.correctEntry).toHaveBeenCalledWith(
        'actor-1',
        't1',
        'e1',
        expect.objectContaining({ declaredAgeDivision: 'JUNIOR', declaredClass: '-51' }),
      ),
    );
  });

  it('never labels a value "tidak dikenali" just because the rule set vocabulary failed to load -- shows a clear warning instead', async () => {
    vi.mocked(api.entries).mockResolvedValue(list([entry()]));
    vi.mocked(api.ruleSetVocabulary).mockRejectedValue(new Error('rule set not found'));
    renderIsolated(<PesertaPage />);
    await screen.findByTestId('entry-row');

    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki data Budi Santoso' }));
    const dialog = await screen.findByRole('dialog', { name: 'Perbaiki Data Peserta' });

    expect(await within(dialog).findByText(/gagal memuat daftar sabuk\/divisi\/class/i)).toBeInTheDocument();
    const belt = within(dialog).getByLabelText('Sabuk');
    expect(within(belt).getByRole('option', { name: 'GEUP_9' })).toBeInTheDocument();
    expect(within(belt).queryByRole('option', { name: /tidak dikenali/i })).not.toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    vi.mocked(api.entries).mockRejectedValue(new Error('server down'));
    renderIsolated(<PesertaPage />);
    expect(await screen.findByText(/gagal memuat data peserta: server down/i)).toBeInTheDocument();
  });
});
