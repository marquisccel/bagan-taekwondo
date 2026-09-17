'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApiSWR } from '../../../../../lib/use-api-swr';

import { BracketView } from '../../../../../components/BracketView';
import { EntryDrawer } from '../../../../../components/EntryDrawer';
import { MoveEntryDialog } from '../../../../../components/MoveEntryDialog';
import { PoolCard } from '../../../../../components/PoolCard';
import { RevisionConflictBanner } from '../../../../../components/RevisionConflictBanner';
import { StatusBadge } from '../../../../../components/StatusBadge';
import { SwapEntryDialog } from '../../../../../components/SwapEntryDialog';
import { api, type CommandOutcome, type EntryDisplay } from '../../../../../lib/api';
import { friendlyMessage, runCommand } from '../../../../../lib/command-error';
import { useDevAuth } from '../../../../../lib/dev-auth';
import { isDraft } from '../../../../../lib/lifecycle';

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

  const summary = categories?.find((c) => c.category_id === categoryId);
  const editable = !!revision && isDraft(revision.lifecycle);

  const reload = () => {
    setConflict(false);
    void mutateRevision();
    void mutateDetail();
  };

  const withOutcomeHandling = async (fn: () => Promise<CommandOutcome>) => {
    const result = await runCommand(fn);
    if (result.ok) {
      void mutateRevision();
      void mutateDetail();
    } else if (result.code === 'REVISION_CONFLICT') {
      setConflict(true);
    } else {
      setBanner(friendlyMessage(result.code, result.message));
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

      {conflict ? <RevisionConflictBanner onReload={reload} /> : null}
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
                  void withOutcomeHandling(() =>
                    api.moveEntry(actorId, revisionId, {
                      entryId,
                      toPoolUid,
                      toSlot: null,
                      expectedLockVersion: lockVersion,
                      idempotencyKey: crypto.randomUUID(),
                      reason: null,
                      complaintId: null,
                    }),
                  );
                }}
                onMovePool={(poolUid, toArenaCode, toOrder) => {
                  if (!revisionId) return;
                  void withOutcomeHandling(() =>
                    api.movePool(actorId, revisionId, {
                      poolUid,
                      toArenaCode,
                      toOrder,
                      expectedLockVersion: lockVersion,
                      idempotencyKey: crypto.randomUUID(),
                      reason: null,
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
            void withOutcomeHandling(() =>
              api.moveEntry(actorId, revisionId, {
                entryId: moveTarget.entry.entryId,
                toPoolUid: poolUid,
                toSlot: null,
                expectedLockVersion: lockVersion,
                idempotencyKey: crypto.randomUUID(),
                reason: null,
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
            void withOutcomeHandling(() =>
              api.swapEntry(actorId, revisionId, {
                entryA: swapTarget.entryId,
                entryB: otherEntryId,
                expectedLockVersion: lockVersion,
                idempotencyKey: crypto.randomUUID(),
                reason: null,
                complaintId: null,
              }),
            );
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
