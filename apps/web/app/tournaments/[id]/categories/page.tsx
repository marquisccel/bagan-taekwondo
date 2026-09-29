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
import { formatCategoryLabel } from '../../../../lib/id-labels';

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
    return (
      <main className="content state-empty">
        Belum ada bagan yang dibuat untuk turnamen ini. Buka tab{' '}
        <a href={`/tournaments/${id}/jadwal`}>Jadwal &amp; Buat Bagan</a> untuk membuatnya.
      </main>
    );
  if (isLoading) return <main className="content state-loading">Memuat kategori…</main>;
  if (error) return <main className="content state-error">Gagal memuat: {error.message}</main>;

  const filtered = categories ? filterCategories(categories, filters) : [];

  return (
    <main className="content">
      <h1>Kategori</h1>

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
        Menampilkan {filtered.length} dari {categories?.length ?? 0} kategori
      </p>
      {filtered.length === 0 ? (
        <div className="panel state-empty">Tidak ada kategori yang cocok dengan filter ini.</div>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                <th>Peserta</th>
                <th>Pool</th>
                <th>Kesiapan</th>
                <th>Kualitas</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.category_id}
                  className="row-clickable"
                  onClick={() => (window.location.href = `/tournaments/${id}/categories/${c.category_id}`)}
                >
                  <td style={{ fontWeight: 600 }}>{formatCategoryLabel(c)}</td>
                  <td className="num">{c.entryCount}</td>
                  <td className="num">{c.poolCount}</td>
                  <td>
                    <span className={`badge ${c.readiness === 'READY' ? 'badge-green' : 'badge-red'}`}>
                      {c.readiness === 'READY' ? 'Siap' : 'Diblokir'}
                    </span>
                  </td>
                  <td>
                    <StatusBadge quality={c.quality} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
