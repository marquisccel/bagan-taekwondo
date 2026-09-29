'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApiSWR } from '../../../../../lib/use-api-swr';

import { api } from '../../../../../lib/api';
import { useDevAuth } from '../../../../../lib/dev-auth';

/**
 * This page is a brief waiting room, not a destination: it polls the draw run until it's SAFE, then
 * redirects straight into "Cek & Atur Bagan" (the session view) with no manual click and no raw
 * engine internals shown -- the team never needs fingerprints, seeds, or dual-run details to check
 * a bagan; that stayed hidden here on purpose after they said this screen was noise.
 */
export default function DrawRunPage() {
  const { id, drawRunId } = useParams<{ id: string; drawRunId: string }>();
  const router = useRouter();
  const { actorId } = useDevAuth();
  const {
    data: run,
    error,
    isLoading,
  } = useApiSWR(actorId ? ['draw-run', drawRunId, actorId] : null, () => api.drawRun(actorId, drawRunId), {
    refreshInterval: (latest) =>
      latest && (latest.status === 'QUEUED' || latest.status === 'RUNNING') ? 1500 : 0,
  });
  const { data: tournament } = useApiSWR(
    actorId && run?.status === 'SAFE' ? ['tournament', id, actorId] : null,
    () => api.tournament(actorId, id),
  );

  const revisionId = tournament?.latestRevision?.id ?? null;

  useEffect(() => {
    if (run?.status === 'SAFE' && revisionId) router.replace(`/tournaments/${id}/sesi/${revisionId}`);
  }, [run?.status, revisionId, id, router]);

  if (isLoading) return <main className="content state-loading">Memuat…</main>;
  if (error) return <main className="content state-error">Gagal memuat: {error.message}</main>;
  if (!run) return <main className="content state-empty">Drawing tidak ditemukan.</main>;

  if (run.status === 'UNSAFE' || run.status === 'FAILED') {
    return (
      <main className="content">
        <h1>Bagan Tidak Bisa Dibuat</h1>
        <div className="banner banner-conflict">
          Bagan untuk slot ini {run.status === 'UNSAFE' ? 'tidak aman untuk dipakai' : 'gagal dibuat'}.
          Silakan coba lagi dari halaman Jadwal &amp; Buat Bagan.
        </div>
        <p>
          <a className="btn btn-primary" href={`/tournaments/${id}/jadwal`}>
            Kembali ke Jadwal &amp; Buat Bagan
          </a>
        </p>
      </main>
    );
  }

  return <main className="content state-loading">Sedang membuat bagan, mohon tunggu…</main>;
}
