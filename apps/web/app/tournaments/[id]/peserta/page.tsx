'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { api, type EntryListItem, type EntryListParams } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import {
  confidenceLabel,
  disciplineLabel,
  eligibilityLabel,
  formatLabel,
  groupSourceLabel,
  groupStatusLabel,
  issueCodeLabel,
  issueSeverityLabel,
  issueStatusLabel,
  registrationStatusLabel,
  streamLabel,
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

const ELIGIBILITY_BADGE: Record<string, string> = {
  READY: 'badge-green',
  OVERRIDDEN: 'badge-yellow',
  DRAWN: 'badge-green',
  BLOCKED: 'badge-red',
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
            <strong>{issueSeverityLabel(i.severity)}</strong>: {issueCodeLabel(i.code)}{' '}
            <code style={{ fontSize: 11 }}>{i.code}</code>
            {i.status !== 'OPEN' ? ` — ${issueStatusLabel(i.status)}` : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function EntryRow({ e }: { e: EntryListItem }) {
  const grouped = e.format !== 'INDIVIDUAL';
  return (
    <tr data-testid="entry-row">
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
        {e.externalRef ? (
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Ref: <code>{e.externalRef}</code>
          </div>
        ) : null}
      </td>
      <td>{e.contingent}</td>
      <td>
        {disciplineLabel(e.declared.discipline)} · {formatLabel(e.declared.format)}
      </td>
      <td>
        {e.category ? (
          <span data-testid="entry-category">{e.category.displayName}</span>
        ) : (
          <>
            <span data-testid="entry-category" style={{ color: 'var(--text-dim)' }}>
              Belum ditetapkan
            </span>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Diajukan: {streamLabel(e.declared.stream)} · {e.declared.ageDivision}
              {e.declared.weightClass ? ` · ${e.declared.weightClass}` : ''}
            </div>
          </>
        )}
      </td>
      <td>{registrationStatusLabel(e.registrationStatus)}</td>
      <td>
        <span className={`badge ${ELIGIBILITY_BADGE[e.eligibilityStatus] ?? 'badge-yellow'}`}>
          {eligibilityLabel(e.eligibilityStatus)}
        </span>
        {e.eligibilityReasons.length > 0 ? (
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }} aria-label="Alasan diblokir">
            {e.eligibilityReasons.map((r) => (
              <li key={r}>
                {issueCodeLabel(r)} <code style={{ fontSize: 11 }}>{r}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td>
        <IssueSummary entry={e} />
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
  const { data, error, isLoading } = useApiSWR(
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
    <main className="content">
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
                  <th>Peserta</th>
                  <th>Kontingen</th>
                  <th>Disiplin</th>
                  <th>Kategori</th>
                  <th>Status pendaftaran</th>
                  <th>Kelayakan</th>
                  <th>Masalah data</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <EntryRow key={e.entryId} e={e} />
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
    </main>
  );
}
