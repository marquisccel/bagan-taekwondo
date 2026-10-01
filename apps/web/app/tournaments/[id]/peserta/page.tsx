'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EntryCorrectionDialog } from '../../../../components/EntryCorrectionDialog';
import { api, type EntryListItem, type EntryListParams } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import { useDebouncedValue } from '../../../../lib/use-debounced-value';
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
  /** '' = every participant; 'NEEDS_REVIEW' = only those with an open data issue -- replaces a plain
   * "Hanya yang bermasalah" checkbox whose purpose wasn't obvious on its own (spelled out here). */
  readonly review: '' | 'NEEDS_REVIEW';
}

const EMPTY: Filters = {
  q: '',
  contingent: '',
  discipline: '',
  categoryId: '',
  eligibility: '',
  review: '',
};

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 12;

/**
 * Shown as a notification-style popover instead of an inline `<details>` expansion: the table sits in
 * a horizontally-scrolling `.panel` (`overflow-x: auto`), and per the CSS overflow spec a container
 * can't mix `overflow-x: auto` with `overflow-y: visible` -- the y axis silently becomes `auto` too,
 * clipping anything that expands downward in place. Portaling to `document.body` with a
 * viewport-`fixed` position sidesteps that entirely, and also stops an open row from pushing every
 * row below it down the page.
 */
function IssueSummary({ entry }: { entry: EntryListItem }) {
  const { error, warning, info } = entry.openIssueCounts;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The initial `left` is only a guess (the popover's real width isn't known until it renders, and
  // CSS lets it size anywhere between min- and max-width). Once it's actually on screen, pull it back
  // in by however much it overflows the right edge -- never based on an assumed width, so it can
  // never end up flush against (or past) the edge regardless of how long its content turns out to be.
  useLayoutEffect(() => {
    if (!open || !pos || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflow > 0.5) setPos((p) => (p ? { ...p, left: p.left - overflow } : p));
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (entry.issues.length === 0) return <span style={{ color: 'var(--text-dim)' }}>Tidak ada</span>;
  // A single issue is shown directly -- no click needed to find out what the one-word summary
  // ("1 peringatan") actually means, and nothing to open a popover for anyway.
  const [singleIssue] = entry.issues;
  if (entry.issues.length === 1 && singleIssue) {
    return (
      <span
        style={{
          color:
            singleIssue.severity === 'ERROR'
              ? 'var(--red)'
              : singleIssue.severity === 'WARNING'
                ? 'var(--yellow)'
                : undefined,
        }}
      >
        <strong>{issueSeverityLabel(singleIssue.severity)}</strong>: {issueCodeLabel(singleIssue.code)}
        {singleIssue.status !== 'OPEN' ? ` · ${issueStatusLabel(singleIssue.status)}` : null}
      </span>
    );
  }
  const parts = [
    error > 0 ? `${error} kesalahan` : null,
    warning > 0 ? `${warning} peringatan` : null,
    info > 0 ? `${info} info` : null,
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(', ') : `${entry.issues.length} sudah ditangani`;

  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) {
        const left = Math.min(r.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
        setPos({ top: r.bottom + 10, left: Math.max(VIEWPORT_MARGIN, left) });
      }
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggle}
        aria-expanded={open}
        className="issue-summary-trigger"
        style={{ color: error > 0 ? 'var(--red)' : warning > 0 ? 'var(--yellow)' : undefined }}
      >
        {summary}
      </button>
      {open && pos
        ? createPortal(
            <>
              <div className="issue-summary-scrim" onClick={() => setOpen(false)} />
              <div
                ref={popoverRef}
                role="dialog"
                aria-label={`Masalah data ${entry.displayName}`}
                className="issue-summary-popover"
                style={{ top: pos.top, left: pos.left }}
              >
                <ul>
                  {entry.issues.map((i) => (
                    <li key={i.id}>
                      <strong>{issueSeverityLabel(i.severity)}</strong>: {issueCodeLabel(i.code)}
                      {i.status !== 'OPEN' ? ` · ${issueStatusLabel(i.status)}` : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
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
  const searchParams = useSearchParams();
  // Lets the dashboard's "Perlu Ditinjau" card link straight to the filtered list
  // (`?review=NEEDS_REVIEW`) instead of landing here and making the team re-apply it by hand. Read
  // once, on the initial render, like any other deep link -- not kept in sync afterward.
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY,
    review: searchParams.get('review') === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : '',
  }));
  const [offset, setOffset] = useState(0);
  const [correcting, setCorrecting] = useState<EntryListItem | null>(null);

  // Free-text fields debounce so typing doesn't fire a request per keystroke; every other filter
  // (a select, a deliberate click) applies the instant it changes -- there's no separate "Terapkan"
  // step to remember, the list just updates as you adjust anything.
  const q = useDebouncedValue(filters.q, 350);
  const contingent = useDebouncedValue(filters.contingent, 350);

  const params: EntryListParams = {
    q: q.trim(),
    contingent: contingent.trim(),
    discipline: filters.discipline,
    categoryId: filters.categoryId,
    eligibility: filters.eligibility,
    hasIssues: filters.review === 'NEEDS_REVIEW' ? true : undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const { data, error, isLoading, mutate } = useApiSWR(
    actorId && id ? ['entries', id, actorId, JSON.stringify(params)] : null,
    () => api.entries(actorId, id, params),
    { keepPreviousData: true },
  );

  // Any filter change re-starts from the first page -- otherwise "page 3" of an old, wider result
  // set could silently show past the end of a newly narrowed one.
  useEffect(() => {
    setOffset(0);
  }, [q, contingent, filters.discipline, filters.categoryId, filters.eligibility, filters.review]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const reset = () => setFilters(EMPTY);

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

      <div className="filters" role="search" aria-label="Filter peserta">
        <input
          aria-label="Cari peserta"
          placeholder="Cari nama peserta…"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
        />
        <input
          aria-label="Cari kontingen"
          placeholder="Cari kontingen…"
          value={filters.contingent}
          onChange={(e) => set('contingent', e.target.value)}
        />
        <select
          aria-label="Disiplin"
          value={filters.discipline}
          onChange={(e) => set('discipline', e.target.value)}
        >
          <option value="">Semua disiplin</option>
          <option value="KYORUGI">Kyorugi</option>
          <option value="POOMSAE">Poomsae</option>
          <option value="FREESTYLE_POOMSAE">Freestyle Poomsae</option>
        </select>
        <select
          aria-label="Kategori"
          value={filters.categoryId}
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
          value={filters.eligibility}
          onChange={(e) => set('eligibility', e.target.value)}
        >
          <option value="">Semua kelayakan</option>
          <option value="READY">Siap</option>
          <option value="BLOCKED">Diblokir</option>
          <option value="OVERRIDDEN">Dikecualikan (override)</option>
          <option value="DRAWN">Sudah diundi</option>
        </select>
        <select
          aria-label="Status peninjauan"
          value={filters.review}
          onChange={(e) => set('review', e.target.value as Filters['review'])}
        >
          <option value="">Semua peserta</option>
          <option value="NEEDS_REVIEW">Perlu ditinjau (ada masalah data)</option>
        </select>
        <button type="button" className="btn" onClick={reset}>
          Atur ulang
        </button>
      </div>

      {isLoading && !data ? <div className="state-loading">Memuat data peserta…</div> : null}
      {error ? <div className="state-error">Gagal memuat data peserta: {error.message}</div> : null}

      {data ? (
        data.items.length === 0 ? (
          <div className="panel state-empty" data-testid="entry-empty">
            Tidak ada peserta yang cocok dengan filter ini.
          </div>
        ) : (
          <div className="panel">
            <div style={{ overflowX: 'auto' }}>
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
            <div className="entry-pagination">
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
          </div>
        )
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
