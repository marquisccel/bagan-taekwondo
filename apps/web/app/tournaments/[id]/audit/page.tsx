'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApiSWR } from '../../../../lib/use-api-swr';

import { api } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import { auditDetail } from '../../../../lib/audit-detail';

export default function AuditPage() {
  const { id } = useParams<{ id: string }>();
  const { actorId } = useDevAuth();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, error, isLoading } = useApiSWR(actorId ? ['audit', id, actorId, cursor] : null, () =>
    api.audit(actorId, id, cursor),
  );

  if (isLoading) return <main className="content state-loading">Memuat riwayat…</main>;
  if (error) return <main className="content state-error">Gagal memuat: {error.message}</main>;
  if (!data || data.events.length === 0)
    return <main className="content state-empty">Belum ada riwayat perubahan.</main>;

  return (
    <main className="content">
      <h1>Riwayat</h1>
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Tindakan</th>
              <th>Subjek</th>
              <th>Alasan</th>
              <th>Detail</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.seq}>
                <td>{new Date(e.occurred_at).toLocaleString('id-ID')}</td>
                <td>{e.action}</td>
                <td>
                  {e.subject_type} {e.subject_id?.slice(0, 8) ?? ''}
                </td>
                <td>{e.reason ?? '·'}</td>
                <td data-testid="audit-detail">{auditDetail(e.action, e.after) ?? '·'}</td>
                <td>
                  <code style={{ fontSize: 11 }}>{e.hash.slice(0, 18)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.nextCursor ? (
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => setCursor(data.nextCursor as string)}
        >
          Muat peristiwa lebih lama
        </button>
      ) : null}
    </main>
  );
}
