'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApiSWR } from '../../../../lib/use-api-swr';

import { CategoryFilters } from '../../../../components/CategoryFilters';
import { LifecycleBar } from '../../../../components/LifecycleBar';
import { ParticipantSearch } from '../../../../components/ParticipantSearch';
import { RevisionConflictBanner } from '../../../../components/RevisionConflictBanner';
import { StatusBadge } from '../../../../components/StatusBadge';
import { api } from '../../../../lib/api';
import { EMPTY_FILTERS, filterCategories } from '../../../../lib/category-filters';
import { useDevAuth } from '../../../../lib/dev-auth';

export default function CategoriesPage() {
  const { id } = useParams<{ id: string }>();
  const { actorId } = useDevAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [conflict, setConflict] = useState(false);

  const { data: tournament, mutate: mutateTournament } = useApiSWR(
    actorId && id ? ['tournament', id, actorId] : null,
    () => api.tournament(actorId, id),
  );
  const revisionId = tournament?.latestRevision?.id ?? null;

  const { data: revision, mutate: mutateRevision } = useApiSWR(
    actorId && revisionId ? ['revision', revisionId, actorId] : null,
    () => api.revision(actorId, revisionId as string),
  );

  const {
    data: categories,
    error,
    isLoading,
    mutate: mutateCategories,
  } = useApiSWR(
    actorId && revisionId ? ['categories', revisionId, actorId] : null,
    () => api.categories(actorId, revisionId as string),
    { refreshInterval: 20_000 },
  );

  const reload = () => {
    setConflict(false);
    void mutateTournament();
    void mutateRevision();
    void mutateCategories();
  };

  if (tournament && !revisionId)
    return <main className="content state-empty">No draw run has produced a revision yet.</main>;
  if (isLoading) return <main className="content state-loading">Loading categories…</main>;
  if (error) return <main className="content state-error">Failed to load: {error.message}</main>;

  const filtered = categories ? filterCategories(categories, filters) : [];

  return (
    <main className="content">
      <h1>Categories</h1>

      {conflict ? <RevisionConflictBanner onReload={reload} /> : null}

      {revision ? (
        <LifecycleBar
          lifecycle={revision.lifecycle}
          lockVersion={revision.lock_version}
          revisionId={revision.id}
          onChanged={(outcome) => {
            reload();
            if (outcome.resultingRevisionId && outcome.resultingRevisionId !== revision.id) {
              window.location.href = `/tournaments/${id}/categories`;
            }
          }}
          onConflict={() => setConflict(true)}
        />
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <ParticipantSearch tournamentId={id} />
      </div>
      <CategoryFilters value={filters} onChange={setFilters} />
      <p style={{ color: 'var(--text-dim)' }}>
        {filtered.length} of {categories?.length ?? 0} categories
      </p>
      {filtered.length === 0 ? (
        <div className="panel state-empty">No categories match these filters.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Discipline</th>
              <th>Gender</th>
              <th>Format</th>
              <th>Entries</th>
              <th>Pools</th>
              <th>Readiness</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.category_id}
                className="row-clickable"
                onClick={() => (window.location.href = `/tournaments/${id}/categories/${c.category_id}`)}
              >
                <td>{c.category_key}</td>
                <td>{c.discipline}</td>
                <td>{c.gender}</td>
                <td>{c.format}</td>
                <td>{c.entryCount}</td>
                <td>{c.poolCount}</td>
                <td>{c.readiness}</td>
                <td>
                  <StatusBadge quality={c.quality} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
