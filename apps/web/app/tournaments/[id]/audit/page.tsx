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

  if (isLoading) return <main className="content state-loading">Loading audit history…</main>;
  if (error) return <main className="content state-error">Failed to load: {error.message}</main>;
  if (!data || data.events.length === 0)
    return <main className="content state-empty">No audit events yet.</main>;

  return (
    <main className="content">
      <h1>Audit history</h1>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Subject</th>
            <th>Reason</th>
            <th>Detail</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={e.seq}>
              <td>{new Date(e.occurred_at).toLocaleString()}</td>
              <td>{e.action}</td>
              <td>
                {e.subject_type} {e.subject_id?.slice(0, 8) ?? ''}
              </td>
              <td>{e.reason ?? '—'}</td>
              <td data-testid="audit-detail">{auditDetail(e.action, e.after) ?? '—'}</td>
              <td>
                <code style={{ fontSize: 11 }}>{e.hash.slice(0, 18)}…</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.nextCursor ? (
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() => setCursor(data.nextCursor as string)}
        >
          Load older events
        </button>
      ) : null}
    </main>
  );
}
