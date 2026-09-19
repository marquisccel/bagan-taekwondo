'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApiSWR } from '../../../../../lib/use-api-swr';

import { BracketView } from '../../../../../components/BracketView';
import { CommandFeedback, ReasonPrompt } from '../../../../../components/CommandFeedback';
import { EntryDrawer } from '../../../../../components/EntryDrawer';
import { ExportPanel } from '../../../../../components/ExportPanel';
import { MoveEntryDialog } from '../../../../../components/MoveEntryDialog';
import { PoolCard } from '../../../../../components/PoolCard';
import { RevisionConflictBanner } from '../../../../../components/RevisionConflictBanner';
import { StatusBadge } from '../../../../../components/StatusBadge';
import { SwapEntryDialog } from '../../../../../components/SwapEntryDialog';
import { api, type CommandOutcome, type CommandVerdict, type EntryDisplay } from '../../../../../lib/api';
import { friendlyCommandRefusal, friendlyMessage, runCommand } from '../../../../../lib/command-error';
import { useDevAuth } from '../../../../../lib/dev-auth';
import { isDraft } from '../../../../../lib/lifecycle';

type CommandCall = (reason: string | null) => Promise<CommandOutcome>;

export default function CategoryDetailPage() {
  const { id, categoryId } = useParams<{ id: string; categoryId: string }>();
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
  const [moveTarget, setMoveTarget] = useState<{ entry: EntryDisplay; poolId: string } | null>(null);
  const [swapTarget, setSwapTarget] = useState<EntryDisplay | null>(null);
  const [conflict, setConflict] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandVerdict | null>(null);
  const [pending, setPending] = useState<{ call: CommandCall; verdict: CommandVerdict } | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (isLoading) return <main className="content state-loading">Loading category…</main>;
  if (error) return <main className="content state-error">Failed to load: {error.message}</main>;
  if (!detail) return <main className="content state-empty">Category not found.</main>;

  const lockVersion = revision?.lock_version ?? 0;
  const allPools = detail.pools;

  return (
    <main className="content">
      <h1>{detail.category.category_key}</h1>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <StatusBadge quality={summary?.quality ?? (detail.readiness === 'BLOCKED' ? 'RED' : 'GREEN')} />
        <span style={{ color: 'var(--text-dim)' }}>{detail.readiness}</span>
        {revision ? <span style={{ color: 'var(--text-dim)' }}>· revision {revision.lifecycle}</span> : null}
        {!editable ? <span className="badge badge-yellow">read-only</span> : null}
      </div>

      {revisionId ? (
        <ExportPanel
          revisionId={revisionId}
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
            Dismiss
          </button>
        </div>
      ) : null}

      {detail.readiness === 'BLOCKED' ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, color: 'var(--red)' }}>Blocked</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {JSON.stringify(detail.blockedReasons, null, 2)}
          </pre>
        </div>
      ) : null}

      {!editable && revision ? (
        <div className="banner banner-info">
          Revision is {revision.lifecycle} — moves and swaps are disabled. Only a DRAFT revision accepts them.
        </div>
      ) : null}

      {allPools.length === 0 ? (
        <div className="panel state-empty">No pools in this revision for this category.</div>
      ) : (
        <>
          <section aria-label="Pools" className="pool-board" style={{ marginBottom: 24 }}>
            {allPools.map((p) => (
              <PoolCard
                key={p.id}
                pool={p}
                editable={editable}
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

          <h2>Brackets</h2>
          <div className="grid">
            {allPools.map((p) =>
              p.bracket ? (
                <div key={p.id} className="panel">
                  <h3 style={{ marginTop: 0 }}>{p.poolUid}</h3>
                  <BracketView bracket={p.bracket} />
                  {revisionId ? (
                    <ExportPanel
                      revisionId={revisionId}
                      availableTypes={['POOL_SHEET', 'BRACKET_SHEET']}
                      poolId={p.id}
                    />
                  ) : null}
                </div>
              ) : null,
            )}
          </div>
        </>
      )}

      {selected ? (
        <EntryDrawer
          entry={selected}
          categoryMovement={detail.category.movement}
          onClose={() => setSelected(null)}
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
          Unknown actor for this tournament — connect as a real member to act.
        </div>
      ) : null}
    </main>
  );
}
