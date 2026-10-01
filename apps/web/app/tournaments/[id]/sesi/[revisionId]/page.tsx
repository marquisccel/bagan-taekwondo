'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { BracketView } from '../../../../../components/BracketView';
import { ExportPanel } from '../../../../../components/ExportPanel';
import { RevisionConflictBanner } from '../../../../../components/RevisionConflictBanner';
import { api, type EntryDisplay, type SessionCategory } from '../../../../../lib/api';
import { friendlyCommandRefusal, friendlyMessage, runCommand } from '../../../../../lib/command-error';
import { useDevAuth } from '../../../../../lib/dev-auth';
import {
  ageDivisionLabel,
  categoryKeyDims,
  formatCategoryLabel,
  humanizeCode,
} from '../../../../../lib/id-labels';
import { isDraft } from '../../../../../lib/lifecycle';
import { useApiSWR } from '../../../../../lib/use-api-swr';

const fmtHeight = (mm: number | null): string => (mm !== null ? `${Math.round(mm / 10)} cm` : '·');
const fmtWeight = (g: number | null): string => (g !== null ? `${(g / 1000).toFixed(1)} kg` : '·');
const fmtBelt = (label: string | null, code: string | null): string =>
  label ?? (code ? humanizeCode(code) : '·');
const genderWord = (g: string | null): string => (g === 'MALE' ? 'Putra' : g === 'FEMALE' ? 'Putri' : '·');

/** One pool's rows within a category table — the whole `<tbody>` is the drop target, mirroring
 * PoolCard's "whole card is a drop zone" pattern, just laid out as dense spreadsheet rows instead
 * of cards (per the team's request: match the committee's own SPS arena-tab look). The "Pool N"
 * heading row only appears when a category actually has more than one pool to switch between --
 * most categories here have exactly one, so nothing extra clutters the common case. */
function PoolRows({
  poolLabel,
  members,
  editable,
  onDropEntry,
  onDragStartEntry,
}: {
  poolLabel: string | null;
  members: readonly EntryDisplay[];
  editable: boolean;
  onDropEntry: (entryId: string) => void;
  onDragStartEntry: (e: React.DragEvent, entryId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <tbody
      className={over ? 'session-pool-over' : undefined}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setOver(false);
        const entryId = e.dataTransfer.getData('text/entry-id');
        if (entryId) onDropEntry(entryId);
      }}
    >
      {poolLabel ? (
        <tr>
          <td colSpan={7} className="session-pool-heading">
            {poolLabel}
          </td>
        </tr>
      ) : null}
      {members.map((m) => {
        const a = m.athletes[0];
        return (
          <tr
            key={m.entryId}
            className="session-row"
            draggable={editable}
            onDragStart={(e) => onDragStartEntry(e, m.entryId)}
          >
            <td>
              <code style={{ fontSize: 11 }}>{m.externalRef ?? '·'}</code>
            </td>
            <td style={{ fontWeight: 600 }}>
              {editable ? <span className="session-row-handle" aria-hidden="true" /> : null}
              {m.displayName}
            </td>
            <td>{m.contingent}</td>
            <td>{genderWord(a?.gender ?? null)}</td>
            <td className="num">{fmtHeight(a?.heightMm ?? null)}</td>
            <td className="num">{fmtWeight(a?.weightG ?? null)}</td>
            <td>{fmtBelt(a?.beltLabel ?? null, a?.beltCode ?? null)}</td>
          </tr>
        );
      })}
      {members.length === 0 ? (
        <tr>
          <td colSpan={7} style={{ color: 'var(--text-dim)' }}>
            Belum ada peserta
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function CategoryTable({
  cat,
  editable,
  savingMatchId,
  onMove,
  onSetDisplayNo,
  onSwapEntries,
}: {
  cat: SessionCategory;
  editable: boolean;
  savingMatchId: string | null;
  onMove: (entryId: string, toPoolUid: string) => void;
  onSetDisplayNo: (matchId: string, displayNo: number | null) => void;
  onSwapEntries: (entryIdA: string, entryIdB: string) => void;
}) {
  const multiPool = cat.pools.length > 1;
  const hasBracket = cat.pools.some((p) => p.bracket && p.bracket.matches.length > 0);
  const [view, setView] = useState<'tabel' | 'bracket'>('tabel');
  const dims = categoryKeyDims(cat.category.category_key);
  const ageDivision = dims.get('AGE_DIVISION');
  const weightClass = dims.get('WEIGHT_CLASS');
  const categoryLabels = {
    divisi: ageDivision ? ageDivisionLabel(ageDivision) : '·',
    // The committee's reference table shows the weight class as its raw rule-set code (e.g. "-42",
    // "+78"), not a spelled-out "Under/Over ... kg" phrase.
    kelas:
      weightClass && weightClass !== 'INDIVIDUAL' && weightClass !== 'PAIR' && weightClass !== 'TEAM'
        ? weightClass
        : '·',
  };

  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 14 }}>{formatCategoryLabel(cat.category)}</h3>

      {hasBracket ? (
        <div className="session-view-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'tabel'}
            className={view === 'tabel' ? 'active' : ''}
            onClick={() => setView('tabel')}
          >
            Tabel
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'bracket'}
            className={view === 'bracket' ? 'active' : ''}
            onClick={() => setView('bracket')}
          >
            Bracket
          </button>
        </div>
      ) : null}

      {view === 'tabel' || !hasBracket ? (
        <>
          {multiPool ? (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 0 }}>
              Kategori ini punya {cat.pools.length} pool. Geser (drag) nama peserta ke bagian pool lain di
              bawah untuk menukar.
            </p>
          ) : null}
          <div style={{ overflowX: 'auto' }}>
            <table className="session-table">
              <colgroup>
                <col className="col-id" />
                <col className="col-nama" />
                <col className="col-kontingen" />
                <col className="col-kelamin" />
                <col className="col-tinggi" />
                <col className="col-berat" />
                <col className="col-sabuk" />
              </colgroup>
              <thead>
                <tr>
                  <th>ID Atlet</th>
                  <th>Nama</th>
                  <th>Kontingen</th>
                  <th>Kelamin</th>
                  <th>Tinggi</th>
                  <th>Berat</th>
                  <th>Sabuk</th>
                </tr>
              </thead>
              {cat.pools.map((p) => (
                <PoolRows
                  key={p.id}
                  poolLabel={multiPool ? `Pool ${p.ordinal}` : null}
                  members={p.members}
                  editable={editable}
                  onDropEntry={(entryId) => onMove(entryId, p.poolUid)}
                  onDragStartEntry={(e, entryId) => e.dataTransfer.setData('text/entry-id', entryId)}
                />
              ))}
            </table>
          </div>
        </>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            Nomor pertandingan: isi kotak &quot;No.&quot; di bawah tiap pertandingan.
            {editable
              ? ' Geser (drag) nama peserta ke peserta lain untuk menukar posisi mereka di bagan.'
              : ''}
          </div>
          {cat.pools.map((p) =>
            p.bracket ? (
              <BracketView
                key={p.id}
                bracket={p.bracket}
                editable
                savingMatchId={savingMatchId}
                categoryLabels={categoryLabels}
                onSetDisplayNo={onSetDisplayNo}
                onSwapEntries={editable ? onSwapEntries : undefined}
              />
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}

export default function SesiPage() {
  const { id, revisionId } = useParams<{ id: string; revisionId: string }>();
  const searchParams = useSearchParams();
  const dayNumber = searchParams.get('dayNumber');
  const arenaCode = searchParams.get('arenaCode');
  const slotLabel = dayNumber && arenaCode ? `DAY ${dayNumber} · Arena ${arenaCode}` : null;
  const { actorId } = useDevAuth();
  const [conflict, setConflict] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);

  const {
    data: revision,
    mutate: mutateRevision,
    error: revisionError,
  } = useApiSWR(actorId ? ['revision', revisionId, actorId] : null, () => api.revision(actorId, revisionId));
  const {
    data: session,
    mutate: mutateSession,
    error: sessionError,
    isLoading,
  } = useApiSWR(actorId ? ['session', revisionId, actorId, dayNumber, arenaCode] : null, () =>
    api.session(actorId, revisionId, dayNumber ? Number(dayNumber) : undefined, arenaCode ?? undefined),
  );

  const reload = () => {
    setConflict(false);
    void mutateRevision();
    void mutateSession();
  };

  if (revisionError || sessionError)
    return (
      <main className="content state-error">Gagal memuat: {(revisionError ?? sessionError)?.message}</main>
    );
  if (isLoading || !revision || !session) return <main className="content state-loading">Memuat sesi…</main>;
  if (session.length === 0)
    return <main className="content state-empty">Belum ada kategori pada revisi ini.</main>;

  const editable = isDraft(revision.lifecycle);

  const handleMove = async (entryId: string, toPoolUid: string) => {
    const result = await runCommand(() =>
      api.moveEntry(actorId, revisionId, {
        entryId,
        toPoolUid,
        toSlot: null,
        expectedLockVersion: revision.lock_version,
        idempotencyKey: crypto.randomUUID(),
        reason: null,
        complaintId: null,
      }),
    );
    if (result.ok) {
      setBanner(null);
      reload();
    } else if (result.code === 'REVISION_CONFLICT') {
      setConflict(true);
    } else {
      setBanner(friendlyCommandRefusal(result) ?? friendlyMessage(result.code, result.message));
    }
  };

  const handleSwapEntries = async (entryIdA: string, entryIdB: string) => {
    const result = await runCommand(() =>
      api.swapEntry(actorId, revisionId, {
        entryA: entryIdA,
        entryB: entryIdB,
        expectedLockVersion: revision.lock_version,
        idempotencyKey: crypto.randomUUID(),
        reason: null,
        complaintId: null,
      }),
    );
    if (result.ok) {
      setBanner(null);
      reload();
    } else if (result.code === 'REVISION_CONFLICT') {
      setConflict(true);
    } else {
      setBanner(friendlyCommandRefusal(result) ?? friendlyMessage(result.code, result.message));
    }
  };

  const handleSetDisplayNo = async (matchId: string, displayNo: number | null) => {
    setSavingMatchId(matchId);
    try {
      const result = await runCommand(() =>
        api.setMatchDisplayNo(actorId, revisionId, {
          matchId,
          displayNo,
          expectedLockVersion: revision.lock_version,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      if (result.ok) {
        setBanner(null);
        reload();
      } else if (result.code === 'REVISION_CONFLICT') {
        setConflict(true);
      } else {
        setBanner(friendlyCommandRefusal(result) ?? friendlyMessage(result.code, result.message));
      }
    } finally {
      setSavingMatchId(null);
    }
  };

  return (
    <main className="content content-wide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h1>Cek &amp; Atur Bagan</h1>
        <a className="btn" href={`/tournaments/${id}/jadwal`}>
          Kembali ke Jadwal
        </a>
      </div>
      <p style={{ color: 'var(--text-dim)' }}>
        Tampilan sesuai tab SPS. Setiap kategori di bawah menampilkan pesertanya; kalau kategori punya lebih
        dari satu pool, geser (drag) nama peserta ke pool lain untuk menukar. Isi nomor pertandingan di bagan
        di bawah tiap kategori.
      </p>

      <ExportPanel
        revisionId={revisionId}
        revisionLifecycle={revision.lifecycle}
        availableTypes={['SEMI_PRESTASI_COMPACT_DRAW_SHEET', 'TOURNAMENT_DRAW_BOOK']}
        slotLabel={slotLabel ?? undefined}
      />

      {!editable ? (
        <div className="banner banner-info">
          Revisi ini sudah tidak berstatus Draf, jadi pemindahan peserta dinonaktifkan (hanya baca). Nomor
          pertandingan masih bisa diubah kapan saja.
        </div>
      ) : null}

      {conflict ? <RevisionConflictBanner onReload={reload} /> : null}
      {banner ? (
        <div className="banner banner-conflict" role="alert">
          <span>{banner}</span>
          <button className="btn" onClick={() => setBanner(null)}>
            Tutup
          </button>
        </div>
      ) : null}

      {session.map((cat) => (
        <CategoryTable
          key={cat.category.category_id}
          cat={cat}
          editable={editable}
          savingMatchId={savingMatchId}
          onMove={handleMove}
          onSetDisplayNo={handleSetDisplayNo}
          onSwapEntries={handleSwapEntries}
        />
      ))}
    </main>
  );
}
