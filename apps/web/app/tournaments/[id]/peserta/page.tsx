'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { EntryCorrectionDialog } from '../../../../components/EntryCorrectionDialog';
import { api, type EntryListItem, type EntryListParams } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import {
  ageDivisionLabel,
  confidenceLabel,
  disciplineLabel,
  formatLabel,
  groupSourceLabel,
  groupStatusLabel,
  humanizeCode,
  issueCodeLabel,
  issueSeverityLabel,
  issueStatusLabel,
  streamLabel,
  weightClassDisplayLabel,
} from '../../../../lib/id-labels';
import { useApiSWR } from '../../../../lib/use-api-swr';

const PAGE_SIZE = 50;

interface Filters {
  readonly q: string;
  readonly contingent: string;
  readonly discipline: string;
  readonly categoryId: string;
  readonly eligibility: string;
  readonly hasIssues: boolean;
}

const EMPTY: Filters = {
  q: '',
  contingent: '',
  discipline: '',
  categoryId: '',
  eligibility: '',
  hasIssues: false,
};

function IssueSummary({ entry }: { entry: EntryListItem }) {
  const { error, warning, info } = entry.openIssueCounts;
  if (entry.issues.length === 0) return <span style={{ color: 'var(--text-dim)' }}>Tidak ada</span>;
  const parts = [
    error > 0 ? `${error} kesalahan` : null,
    warning > 0 ? `${warning} peringatan` : null,
    info > 0 ? `${info} info` : null,
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(', ') : `${entry.issues.length} sudah ditangani`;
  return (
    <details>
      <summary
        style={{
          cursor: 'pointer',
          color: error > 0 ? 'var(--red)' : warning > 0 ? 'var(--yellow)' : undefined,
        }}
      >
        {summary}
      </summary>
      <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
        {entry.issues.map((i) => (
          <li key={i.id}>
            <strong>{issueSeverityLabel(i.severity)}</strong>: {issueCodeLabel(i.code)}
            {i.status !== 'OPEN' ? ` · ${issueStatusLabel(i.status)}` : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

const fmtHeight = (mm: number | null): string => (mm !== null ? `${Math.round(mm / 10)} cm` : '·');
const fmtWeight = (g: number | null): string => (g !== null ? `${(g / 1000).toFixed(1)} kg` : '·');
const fmtBirthDate = (d: string | null): string =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { timeZone: 'UTC' }) : '·';
/** "GEUP_7" -> "Geup 7" -- the only belt detail this data actually carries (no color/strip is
 * imported); shown identically here and in the "Cek & Atur Bagan" session view. */
const fmtBelt = (label: string | null, code: string | null): string =>
  label ?? (code ? humanizeCode(code) : '·');
const genderWord = (g: string | null): string => (g === 'MALE' ? 'Putra' : g === 'FEMALE' ? 'Putri' : '·');

function EntryRow({ e, onCorrect }: { e: EntryListItem; onCorrect: (e: EntryListItem) => void }) {
  const grouped = e.format !== 'INDIVIDUAL';
  const first = e.members[0];
  return (
    <tr data-testid="entry-row">
      <td>
        <code style={{ fontSize: 11 }}>{e.externalRef ?? '·'}</code>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{e.displayName}</div>
        {grouped ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            <span className="badge badge-yellow" data-testid="entry-format-badge">
              {formatLabel(e.format)}
            </span>{' '}
            {e.members.length} anggota
            {e.group
              ? ` · Pengelompokan: ${groupStatusLabel(e.group.status)} (${groupSourceLabel(e.group.source)}, keyakinan ${confidenceLabel(e.group.confidence)})`
              : ''}
          </div>
        ) : null}
      </td>
      <td>{e.contingent}</td>
      <td>{genderWord(first?.gender ?? null)}</td>
      <td className="num">{fmtBirthDate(first?.birthDate ?? null)}</td>
      <td className="num">{fmtHeight(first?.heightMm ?? null)}</td>
      <td className="num">{fmtWeight(first?.weightG ?? null)}</td>
      <td>{fmtBelt(first?.beltLabel ?? null, first?.beltCode ?? null)}</td>
      <td>
        {disciplineLabel(e.declared.discipline)} {streamLabel(e.declared.stream)}
      </td>
      <td>{ageDivisionLabel(e.declared.ageDivision)}</td>
      <td>{e.declared.weightClass ? weightClassDisplayLabel(e.declared.weightClass) : '·'}</td>
      <td>
        <IssueSummary entry={e} />
      </td>
      <td>
        {!grouped ? (
          <button
            type="button"
            className="btn icon-btn"
            aria-label={`Perbaiki data ${e.displayName}`}
            title="Perbaiki data peserta"
            onClick={() => onCorrect(e)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>·</span>
        )}
      </td>
    </tr>
  );
}

/** AUD-009: read-only participant / entry inspection. Everything shown is what the backend persisted. */
export default function PesertaPage() {
  const { id } = useParams<{ id: string }>();
  const { actorId } = useDevAuth();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);
  const [correcting, setCorrecting] = useState<EntryListItem | null>(null);

  const params: EntryListParams = {
    q: applied.q.trim(),
    contingent: applied.contingent.trim(),
    discipline: applied.discipline,
    categoryId: applied.categoryId,
    eligibility: applied.eligibility,
    hasIssues: applied.hasIssues ? true : undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const { data, error, isLoading, mutate } = useApiSWR(
    actorId && id ? ['entries', id, actorId, JSON.stringify(params)] : null,
    () => api.entries(actorId, id, params),
    { keepPreviousData: true },
  );

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const submit = (ev: React.SyntheticEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setOffset(0);
    setApplied(draft);
  };
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setOffset(0);
  };

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="content content-wide">
      <h1>Peserta</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Pemeriksaan data peserta yang sudah tersimpan (hanya-baca). Kelayakan dan masalah data berasal dari
        hasil validasi sistem.
      </p>

      <form className="filters" role="search" aria-label="Filter peserta" onSubmit={submit}>
        <input
          aria-label="Cari peserta"
          placeholder="Cari nama peserta…"
          value={draft.q}
          onChange={(e) => set('q', e.target.value)}
        />
        <input
          aria-label="Cari kontingen"
          placeholder="Cari kontingen…"
          value={draft.contingent}
          onChange={(e) => set('contingent', e.target.value)}
        />
        <select
          aria-label="Disiplin"
          value={draft.discipline}
          onChange={(e) => set('discipline', e.target.value)}
        >
          <option value="">Semua disiplin</option>
          <option value="KYORUGI">Kyorugi</option>
          <option value="POOMSAE">Poomsae</option>
          <option value="FREESTYLE_POOMSAE">Freestyle Poomsae</option>
        </select>
        <select
          aria-label="Kategori"
          value={draft.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
        >
          <option value="">Semua kategori</option>
          <option value="NONE">Belum ditetapkan</option>
          {(data?.facets.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Kelayakan"
          value={draft.eligibility}
          onChange={(e) => set('eligibility', e.target.value)}
        >
          <option value="">Semua kelayakan</option>
          <option value="READY">Siap</option>
          <option value="BLOCKED">Diblokir</option>
          <option value="OVERRIDDEN">Dikecualikan (override)</option>
          <option value="DRAWN">Sudah diundi</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={draft.hasIssues}
            onChange={(e) => set('hasIssues', e.target.checked)}
          />
          Hanya yang bermasalah
        </label>
        <button type="submit" className="btn btn-primary">
          Terapkan
        </button>
        <button type="button" className="btn" onClick={reset}>
          Atur ulang
        </button>
      </form>

      {isLoading && !data ? <div className="state-loading">Memuat data peserta…</div> : null}
      {error ? <div className="state-error">Gagal memuat data peserta: {error.message}</div> : null}

      {data ? (
        data.items.length === 0 ? (
          <div className="panel state-empty" data-testid="entry-empty">
            Tidak ada peserta yang cocok dengan filter ini.
          </div>
        ) : (
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table aria-label="Daftar peserta">
              <thead>
                <tr>
                  <th>ID Atlet</th>
                  <th>Nama</th>
                  <th>Kontingen</th>
                  <th>Kelamin</th>
                  <th>Tgl. Lahir</th>
                  <th>TB</th>
                  <th>BB</th>
                  <th>Sabuk</th>
                  <th>Klasifikasi</th>
                  <th>Divisi</th>
                  <th>Class</th>
                  <th>Masalah data</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <EntryRow key={e.entryId} e={e} onCorrect={setCorrecting} />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {data ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <span data-testid="entry-range">
            Menampilkan {from}–{to} dari {total} peserta
          </span>
          <button
            type="button"
            className="btn"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Sebelumnya
          </button>
          <button
            type="button"
            className="btn"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Berikutnya
          </button>
        </div>
      ) : null}

      {correcting ? (
        <EntryCorrectionDialog
          entry={correcting}
          tournamentId={id}
          actorId={actorId}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            void mutate();
          }}
        />
      ) : null}
    </main>
  );
}
