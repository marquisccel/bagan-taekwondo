'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiSWR } from '../../../../../lib/use-api-swr';

import { BracketView } from '../../../../../components/BracketView';
import { CategoryNavigator } from '../../../../../components/CategoryNavigator';
import { CommandFeedback, ReasonPrompt } from '../../../../../components/CommandFeedback';
import { DrawingHeader } from '../../../../../components/DrawingHeader';
import { DrawingViewSwitcher, type DrawingView } from '../../../../../components/DrawingViewSwitcher';
import { EntryDrawer } from '../../../../../components/EntryDrawer';
import { ExportPanel } from '../../../../../components/ExportPanel';
import { LifecycleBar } from '../../../../../components/LifecycleBar';
import { MoveEntryDialog } from '../../../../../components/MoveEntryDialog';
import { PoolCard } from '../../../../../components/PoolCard';
import { RevisionConflictBanner } from '../../../../../components/RevisionConflictBanner';
import { SwapEntryDialog } from '../../../../../components/SwapEntryDialog';
import {
  api,
  type CategorySummary,
  type CommandOutcome,
  type CommandVerdict,
  type EntryDisplay,
} from '../../../../../lib/api';
import { friendlyCommandRefusal, friendlyMessage, runCommand } from '../../../../../lib/command-error';
import { useDevAuth } from '../../../../../lib/dev-auth';
import { revisionLifecycleLabel } from '../../../../../lib/id-labels';
import { isDraft } from '../../../../../lib/lifecycle';

type CommandCall = (reason: string | null) => Promise<CommandOutcome>;

export default function CategoryDetailPage() {
  const { id, categoryId } = useParams<{ id: string; categoryId: string }>();
  const router = useRouter();
  const { actorId, role } = useDevAuth();

  const { data: tournament } = useApiSWR(actorId && id ? ['tournament', id, actorId] : null, () =>
    api.tournament(actorId, id),
  );
  const revisionId = tournament?.latestRevision?.id ?? null;

  const { data: revision, mutate: mutateRevision } = useApiSWR(
    actorId && revisionId ? ['revision', revisionId, actorId] : null,
    () => api.revision(actorId, revisionId as string),
  );
  const { data: categories } = useApiSWR(
    actorId && revisionId ? ['categories', revisionId, actorId] : null,
    () => api.categories(actorId, revisionId as string),
  );
  const {
    data: detail,
    error,
    isLoading,
    mutate: mutateDetail,
  } = useApiSWR(
    actorId && revisionId && categoryId ? ['category', revisionId, categoryId, actorId] : null,
    () => api.category(actorId, revisionId as string, categoryId),
  );

  const [selected, setSelected] = useState<EntryDisplay | null>(null);
  const [view, setView] = useState<DrawingView>('pools');
  const [moveTarget, setMoveTarget] = useState<{ entry: EntryDisplay; poolId: string } | null>(null);
  const [swapTarget, setSwapTarget] = useState<EntryDisplay | null>(null);
  const [conflict, setConflict] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandVerdict | null>(null);
  const [pending, setPending] = useState<{ call: CommandCall; verdict: CommandVerdict } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);

  const summary = categories?.find((c) => c.category_id === categoryId);
  const editable = !!revision && isDraft(revision.lifecycle);

  const reload = () => {
    setConflict(false);
    void mutateRevision();
    void mutateDetail();
  };

  /**
   * Runs a command through the server's canonical verdict (AUD-005): applied -> show its quality
   * feedback; REASON_REQUIRED -> ask for a reason and send the same command again (a fresh
   * idempotency key, the command body differs); hard refusal -> Indonesian explanation, nothing changed.
   */
  const withOutcomeHandling = async (call: CommandCall, reason: string | null = null) => {
    const result = await runCommand(() => call(reason));
    if (result.ok) {
      setPending(null);
      setBanner(null);
      setFeedback(result.outcome.verdict);
      void mutateRevision();
      void mutateDetail();
    } else if (result.code === 'REVISION_CONFLICT') {
      setPending(null);
      setConflict(true);
    } else if (result.code === 'REASON_REQUIRED' && result.verdict) {
      setPending({ call, verdict: result.verdict });
    } else {
      setPending(null);
      setBanner(friendlyCommandRefusal(result) ?? friendlyMessage(result.code, result.message));
    }
  };

  if (isLoading) return <main className="content state-loading">Memuat kategori…</main>;
  if (error) return <main className="content state-error">Gagal memuat: {error.message}</main>;
  if (!detail) return <main className="content state-empty">Kategori tidak ditemukan.</main>;

  const lockVersion = revision?.lock_version ?? 0;

  const setDisplayNo = async (matchId: string, displayNo: number | null) => {
    if (!revisionId) return;
    setSavingMatchId(matchId);
    try {
      await withOutcomeHandling(() =>
        api.setMatchDisplayNo(actorId, revisionId, {
          matchId,
          displayNo,
          expectedLockVersion: lockVersion,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } finally {
      setSavingMatchId(null);
    }
  };
  const allPools = detail.pools;
  const selectedPoolOrdinal = selected
    ? (allPools.find((p) => p.members.some((m) => m.entryId === selected.entryId))?.ordinal ?? null)
    : null;
  const selectedPoolId = selected
    ? (allPools.find((p) => p.members.some((m) => m.entryId === selected.entryId))?.id ?? null)
    : null;

  const displaySummary: CategorySummary =
    summary ??
    ({
      category_id: categoryId,
      category_key: detail.category.category_key,
      stream: detail.category.stream,
      discipline: detail.category.discipline,
      format: detail.category.format,
      gender: detail.category.gender,
      movement: detail.category.movement,
      readiness: detail.readiness,
      blocked_reasons: detail.blockedReasons,
      selected_strategy: detail.selectedStrategy,
      poolCount: allPools.length,
      entryCount: allPools.reduce((n, p) => n + p.members.length, 0),
      quality: detail.readiness === 'BLOCKED' ? 'RED' : 'GREEN',
    } satisfies CategorySummary);

  return (
    <div className="drawing-workspace">
      {categories && categories.length > 0 ? (
        <CategoryNavigator
          categories={categories}
          selectedCategoryId={categoryId}
          onSelect={(nextId) => router.push(`/tournaments/${id}/categories/${nextId}`)}
        />
      ) : null}

      <main className="content drawing-main">
        <DrawingHeader summary={displaySummary} lifecycle={revision?.lifecycle ?? null} />

        {revision ? (
          <LifecycleBar
            lifecycle={revision.lifecycle}
            lockVersion={revision.lock_version}
            revisionId={revision.id}
            onChanged={(outcome) => {
              reload();
              if (outcome.resultingRevisionId && outcome.resultingRevisionId !== revision.id) {
                router.push(`/tournaments/${id}/categories/${categoryId}`);
              }
            }}
            onConflict={() => setConflict(true)}
          />
        ) : null}

        {revisionId ? (
          <ExportPanel
            revisionId={revisionId}
            revisionLifecycle={revision?.lifecycle ?? 'DRAFT'}
            availableTypes={
              detail.category.stream === 'SEMI_PRESTASI'
                ? ['CATEGORY_DRAW', 'SEMI_PRESTASI_COMPACT_DRAW_SHEET']
                : ['CATEGORY_DRAW']
            }
            categoryId={categoryId}
          />
        ) : null}

        {conflict ? <RevisionConflictBanner onReload={reload} /> : null}
        {feedback ? <CommandFeedback verdict={feedback} onDismiss={() => setFeedback(null)} /> : null}
        {banner ? (
          <div className="banner banner-conflict" role="alert">
            <span>{banner}</span>
            <button className="btn" onClick={() => setBanner(null)}>
              Tutup
            </button>
          </div>
        ) : null}

        {detail.readiness === 'BLOCKED' ? (
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, color: 'var(--red)' }}>Diblokir</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {JSON.stringify(detail.blockedReasons, null, 2)}
            </pre>
          </div>
        ) : null}

        {!editable && revision ? (
          <div className="banner banner-info">
            Revisi berstatus {revisionLifecycleLabel(revision.lifecycle)} — perpindahan dan pertukaran peserta
            dinonaktifkan. Hanya revisi berstatus Draf yang menerimanya.
            <span className="badge badge-neutral" style={{ marginLeft: 8 }}>
              Hanya Baca
            </span>
          </div>
        ) : null}

        {allPools.length === 0 ? (
          <div className="panel state-empty">Belum ada pool pada revisi ini untuk kategori ini.</div>
        ) : (
          <>
            <DrawingViewSwitcher view={view} onChange={setView} />

            {view === 'pools' ? (
              <section aria-label="Pool" className="pool-board">
                {allPools.map((p) => (
                  <PoolCard
                    key={p.id}
                    pool={p}
                    editable={editable}
                    selectedEntryId={selected?.entryId ?? null}
                    onOpenDetail={setSelected}
                    onMoveEntry={(entry) => setMoveTarget({ entry, poolId: p.id })}
                    onSwapEntry={setSwapTarget}
                    onDropEntry={(entryId, toPoolUid) => {
                      const entry = allPools.flatMap((pp) => pp.members).find((m) => m.entryId === entryId);
                      if (!entry || !revisionId) return;
                      void withOutcomeHandling((reason) =>
                        api.moveEntry(actorId, revisionId, {
                          entryId,
                          toPoolUid,
                          toSlot: null,
                          expectedLockVersion: lockVersion,
                          idempotencyKey: crypto.randomUUID(),
                          reason,
                          complaintId: null,
                        }),
                      );
                    }}
                    onMovePool={(poolUid, toArenaCode, toOrder) => {
                      if (!revisionId) return;
                      void withOutcomeHandling((reason) =>
                        api.movePool(actorId, revisionId, {
                          poolUid,
                          toArenaCode,
                          toOrder,
                          expectedLockVersion: lockVersion,
                          idempotencyKey: crypto.randomUUID(),
                          reason,
                          complaintId: null,
                        }),
                      );
                    }}
                  />
                ))}
              </section>
            ) : (
              <div className="grid">
                {allPools.map((p) =>
                  p.bracket ? (
                    <div key={p.id} className="panel">
                      <h3 style={{ marginTop: 0 }}>{p.poolUid}</h3>
                      <BracketView
                        bracket={p.bracket}
                        editable={!!revisionId}
                        savingMatchId={savingMatchId}
                        onSetDisplayNo={setDisplayNo}
                      />
                      {revisionId ? (
                        <ExportPanel
                          revisionId={revisionId}
                          revisionLifecycle={revision?.lifecycle ?? 'DRAFT'}
                          availableTypes={['POOL_SHEET', 'BRACKET_SHEET']}
                          poolId={p.id}
                        />
                      ) : null}
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </>
        )}

        {selected ? (
          <EntryDrawer
            entry={selected}
            category={detail.category}
            poolOrdinal={selectedPoolOrdinal}
            editable={editable}
            onClose={() => setSelected(null)}
            onMove={
              editable && selectedPoolId
                ? () => setMoveTarget({ entry: selected, poolId: selectedPoolId })
                : undefined
            }
            onSwap={editable ? () => setSwapTarget(selected) : undefined}
          />
        ) : null}

        {moveTarget ? (
          <MoveEntryDialog
            entryName={moveTarget.entry.displayName}
            pools={allPools}
            currentPoolId={moveTarget.poolId}
            onCancel={() => setMoveTarget(null)}
            onPick={(poolUid) => {
              setMoveTarget(null);
              if (!revisionId) return;
              void withOutcomeHandling((reason) =>
                api.moveEntry(actorId, revisionId, {
                  entryId: moveTarget.entry.entryId,
                  toPoolUid: poolUid,
                  toSlot: null,
                  expectedLockVersion: lockVersion,
                  idempotencyKey: crypto.randomUUID(),
                  reason,
                  complaintId: null,
                }),
              );
            }}
          />
        ) : null}

        {swapTarget ? (
          <SwapEntryDialog
            entry={swapTarget}
            pools={allPools}
            onCancel={() => setSwapTarget(null)}
            onPick={(otherEntryId) => {
              setSwapTarget(null);
              if (!revisionId) return;
              void withOutcomeHandling((reason) =>
                api.swapEntry(actorId, revisionId, {
                  entryA: swapTarget.entryId,
                  entryB: otherEntryId,
                  expectedLockVersion: lockVersion,
                  idempotencyKey: crypto.randomUUID(),
                  reason,
                  complaintId: null,
                }),
              );
            }}
          />
        ) : null}

        {pending ? (
          <ReasonPrompt
            verdict={pending.verdict}
            busy={busy}
            onCancel={() => setPending(null)}
            onConfirm={(reason) => {
              setBusy(true);
              void withOutcomeHandling(pending.call, reason).finally(() => setBusy(false));
            }}
          />
        ) : null}

        {role === null ? (
          <div className="banner banner-info">
            Aktor tidak dikenal pada turnamen ini — hubungkan sebagai anggota yang sah untuk dapat bertindak.
          </div>
        ) : null}
      </main>
    </div>
  );
}
