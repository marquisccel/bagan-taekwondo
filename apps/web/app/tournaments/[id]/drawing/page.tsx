'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ApiClientError, api, type DrawPreflight, type DrawRun } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import {
  drawReasonLabel,
  drawRunKindLabel,
  drawRunStatusLabel,
  ruleFindingLabel,
  ruleSetStatusLabel,
} from '../../../../lib/id-labels';
import { useApiSWR } from '../../../../lib/use-api-swr';

/** How often the real backend status of a queued/running draw is re-read. */
const DRAW_POLL_MS = 2000;

const MAX_SEED = BigInt('18446744073709551615'); // u64, same bound as parseDrawSeed in @bagantkd/shared
const isValidSeed = (s: string): boolean => /^(0|[1-9][0-9]{0,19})$/.test(s) && BigInt(s) <= MAX_SEED;

const defaultSeed = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

const isTerminal = (s: DrawRun['status']): boolean => s === 'SAFE' || s === 'UNSAFE' || s === 'FAILED';

function createErrorMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 403 || e.code === 'FORBIDDEN_COMMAND' || e.code === 'UNAUTHORIZED_TOURNAMENT_ACCESS')
      return 'Anda tidak memiliki izin untuk membuat drawing. Hanya Petugas Drawing, Delegasi Teknis, atau Admin yang dapat menjalankannya.';
    if (e.code === 'RULE_SET_NOT_READY')
      return 'Set aturan belum aktif atau tidak ditemukan untuk turnamen ini, sehingga drawing tidak dapat dibuat.';
    if (e.code === 'VALIDATION_ERROR' || e.code === 'INVALID_DRAW_SEED')
      return `Permintaan tidak valid: ${e.message}`;
    return `Gagal membuat drawing: ${e.message}`;
  }
  return `Gagal membuat drawing: ${e instanceof Error ? e.message : 'kesalahan tidak diketahui'}`;
}

function reasonParts(r: unknown): { code: string; params: unknown } {
  if (typeof r === 'object' && r !== null && 'code' in r)
    return { code: String(r.code), params: 'params' in r ? r.params : null };
  return { code: typeof r === 'string' ? r : 'UNKNOWN', params: null };
}

function Preflight({ p, tournamentId }: { p: DrawPreflight; tournamentId: string }) {
  const lock = p.ruleSetLock;
  return (
    <section className="panel grid" aria-label="Ringkasan sebelum drawing" data-testid="draw-preflight">
      <h3 style={{ margin: 0 }}>Ringkasan sebelum drawing</h3>

      <div className="stat-row">
        <div className="stat">
          <div className="value" data-testid="preflight-eligible">
            {p.entries.eligible}
          </div>
          <div className="label">Peserta layak</div>
        </div>
        <div className="stat">
          <div
            className="value"
            data-testid="preflight-blocked"
            style={{ color: p.entries.blocked > 0 ? 'var(--red)' : undefined }}
          >
            {p.entries.blocked}
          </div>
          <div className="label">Peserta diblokir</div>
        </div>
        <div className="stat">
          <div
            className="value"
            data-testid="preflight-issues"
            style={{ color: p.openIssues.error + p.openIssues.warning > 0 ? 'var(--yellow)' : undefined }}
          >
            {p.openIssues.error + p.openIssues.warning}
          </div>
          <div className="label">Masalah data terbuka</div>
        </div>
      </div>
      <div style={{ color: 'var(--text-dim)' }}>
        Masalah terbuka: {p.openIssues.error} kesalahan, {p.openIssues.warning} peringatan. Peserta diblokir
        tidak ikut diundi. <a href={`/tournaments/${tournamentId}/peserta`}>Lihat peserta</a>
      </div>

      <div data-testid="preflight-ruleset">
        <strong>Set aturan:</strong>{' '}
        {p.ruleSet ? (
          <>
            {p.ruleSet.name} <code>{p.ruleSet.code}</code> v{p.ruleSet.version} ·{' '}
            {ruleSetStatusLabel(p.ruleSet.status)}
          </>
        ) : (
          'Belum ada set aturan'
        )}
      </div>
      {p.intakeSnapshot ? (
        <div>
          <strong>Data intake:</strong> {p.intakeSnapshot.entryCount} entri (
          {new Date(p.intakeSnapshot.createdAt).toLocaleString('id-ID')})
        </div>
      ) : null}

      {lock ? (
        lock.lockable ? (
          <div className="banner banner-info" data-testid="preflight-lock-status">
            Set aturan ini memenuhi syarat untuk dikunci
            {lock.warningCount > 0 ? ` (${lock.warningCount} peringatan perlu diakui Delegasi Teknis).` : '.'}
          </div>
        ) : (
          <div className="banner banner-conflict" role="status" data-testid="preflight-lock-status">
            <span>
              <strong>Provisional, belum dapat dikunci.</strong> Drawing tetap dapat dibuat sebagai kandidat,
              tetapi hasilnya belum dapat dikunci atau diterbitkan. {lock.blockerCount} hal penghalang,{' '}
              {lock.warningCount} peringatan.
            </span>
          </div>
        )
      ) : null}
      {lock && lock.findings.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18 }} aria-label="Temuan set aturan">
          {lock.findings.map((f) => (
            <li key={`${f.level}-${f.code}`}>
              {ruleFindingLabel(f.code)} <code style={{ fontSize: 11 }}>{f.code}</code> × {f.count}{' '}
              <span style={{ color: 'var(--text-dim)' }}>
                ({f.level === 'LOCK_WARNING' ? 'peringatan' : 'penghalang kunci'})
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {p.blockers.includes('NO_ACTIVE_RULE_SET') ? (
        <div className="banner banner-conflict" role="alert">
          Belum ada set aturan aktif untuk turnamen ini, sehingga drawing belum dapat dibuat.
        </div>
      ) : null}
      {p.blockers.includes('NO_INTAKE_SNAPSHOT') ? (
        <div className="banner banner-conflict" role="alert">
          Belum ada data intake (snapshot pendaftaran) untuk set aturan aktif, sehingga drawing belum dapat
          dibuat.
        </div>
      ) : null}
    </section>
  );
}

function RunStatus({ tournamentId, run }: { tournamentId: string; run: DrawRun }) {
  const reasons = run.unsafe_reasons.map(reasonParts);
  return (
    <section className="panel grid" aria-label="Status drawing" data-testid="draw-run-status">
      <h3 style={{ margin: 0 }}>Status drawing</h3>
      <div>
        <span
          className={`badge ${run.status === 'SAFE' ? 'badge-green' : isTerminal(run.status) ? 'badge-red' : 'badge-yellow'}`}
          data-testid="draw-run-status-badge"
        >
          {drawRunStatusLabel(run.status)}
        </span>{' '}
        <span style={{ color: 'var(--text-dim)' }}>
          {drawRunKindLabel(run.kind)} · seed <code>{run.seed}</code> · <code>{run.status}</code>
        </span>
      </div>

      {!isTerminal(run.status) ? (
        <div role="status">
          {run.status === 'QUEUED'
            ? 'Drawing masuk antrean dan menunggu pekerja (worker) memprosesnya…'
            : 'Drawing sedang diproses…'}{' '}
          Status diperbarui otomatis.
        </div>
      ) : null}

      {run.status === 'SAFE' ? (
        <div className="grid">
          <div className="banner banner-info" role="status">
            Drawing selesai dan aman. Hasil sudah tersedia sebagai revisi draf.
          </div>
          <div>
            <a className="btn btn-primary" href={`/tournaments/${tournamentId}/categories`}>
              Buka ruang kerja drawing
            </a>{' '}
            <a className="btn" href={`/tournaments/${tournamentId}/draws/${run.id}`}>
              Detail draw run
            </a>
          </div>
        </div>
      ) : null}

      {run.status === 'UNSAFE' || run.status === 'FAILED' ? (
        <div className="grid">
          <div className="banner banner-conflict" role="alert">
            {run.status === 'UNSAFE'
              ? 'Drawing dinyatakan TIDAK AMAN oleh sistem dan tidak dapat dipakai. Perbaiki penyebab di bawah, lalu buat drawing baru.'
              : 'Drawing GAGAL diproses. Coba lagi; jika berulang, hubungi tim teknis dengan kode di bawah.'}
          </div>
          {reasons.length > 0 ? (
            <ul aria-label="Alasan dari sistem" style={{ margin: 0, paddingLeft: 18 }}>
              {reasons.map((r, i) => (
                <li key={`${r.code}-${i}`}>
                  {drawReasonLabel(r.code)} <code>{r.code}</code>
                  {r.params && typeof r.params === 'object' && Object.keys(r.params).length > 0 ? (
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>Rincian teknis</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                        {JSON.stringify(r.params, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div>Sistem tidak memberikan alasan rinci.</div>
          )}
          <div>
            <a className="btn" href={`/tournaments/${tournamentId}/draws/${run.id}`}>
              Detail draw run
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** AUD-010: explicit "Buat Drawing" action with a real pre-flight and real backend status. */
export default function DrawingPage() {
  const { id } = useParams<{ id: string }>();
  const { actorId } = useDevAuth();

  const preflight = useApiSWR(actorId && id ? ['draw-preflight', id, actorId] : null, () =>
    api.drawPreflight(actorId, id),
  );

  const [kind, setKind] = useState<'CANDIDATE' | 'SIMULATION'>('CANDIDATE');
  const [seed, setSeed] = useState(defaultSeed);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const run = useApiSWR(
    actorId && runId ? ['draw-run', runId, actorId] : null,
    () => api.drawRun(actorId, runId as string),
    { refreshInterval: (latest) => (latest && isTerminal(latest.status) ? 0 : DRAW_POLL_MS) },
  );

  const p = preflight.data;
  const running = runId !== null && !(run.data && isTerminal(run.data.status));
  const seedOk = isValidSeed(seed.trim());
  const canSubmit =
    !!p && p.canRequest && p.blockers.length === 0 && !!p.ruleSet && !!p.intakeSnapshot && seedOk && !running;

  const execute = async () => {
    if (!p?.ruleSet || !p.intakeSnapshot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.createDrawRun(actorId, id, {
        ruleSetId: p.ruleSet.id,
        intakeSnapshotId: p.intakeSnapshot.id,
        kind,
        seed: seed.trim(),
        scope: [],
      });
      setRunId(created.drawRunId);
      setConfirming(false);
    } catch (e: unknown) {
      setSubmitError(createErrorMessage(e));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (preflight.isLoading) return <main className="content state-loading">Memuat ringkasan drawing…</main>;
  if (preflight.error)
    return (
      <main className="content state-error">Gagal memuat ringkasan drawing: {preflight.error.message}</main>
    );
  if (!p) return <main className="content state-empty">Tidak ada data.</main>;

  return (
    <main className="content grid">
      <h1>
        Buat drawing <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {p.tournament.name}</span>
      </h1>

      <Preflight p={p} tournamentId={id} />

      {!p.canRequest ? (
        <div className="banner banner-conflict" role="alert" data-testid="draw-forbidden">
          Peran Anda ({p.role}) hanya dapat melihat. Anda tidak memiliki izin untuk membuat drawing.
        </div>
      ) : null}

      <section className="panel grid" aria-label="Buat drawing">
        <h3 style={{ margin: 0 }}>Jalankan drawing</h3>
        <div className="filters" style={{ marginBottom: 0 }}>
          <label>
            Jenis drawing{' '}
            <select
              aria-label="Jenis drawing"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'CANDIDATE' | 'SIMULATION')}
              disabled={running}
            >
              <option value="CANDIDATE">Kandidat</option>
              <option value="SIMULATION">Simulasi (tidak dapat dikunci)</option>
            </select>
          </label>
          <label>
            Seed{' '}
            <input
              aria-label="Seed"
              inputMode="numeric"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              aria-invalid={!seedOk}
              disabled={running}
            />
          </label>
        </div>
        {!seedOk ? (
          <div role="alert" style={{ color: 'var(--red)' }}>
            Seed harus berupa bilangan bulat tanpa awalan nol (0 sampai 18446744073709551615).
          </div>
        ) : null}
        <div style={{ color: 'var(--text-dim)' }}>
          Seed yang sama dengan data dan set aturan yang sama selalu menghasilkan drawing yang sama. Semua
          kategori diikutkan.
        </div>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || submitting}
            onClick={() => setConfirming(true)}
          >
            Buat Drawing
          </button>
        </div>

        {submitError ? (
          <div className="banner banner-conflict" role="alert" data-testid="draw-submit-error">
            {submitError}
          </div>
        ) : null}
      </section>

      {confirming ? (
        <div role="dialog" aria-label="Konfirmasi Buat Drawing" aria-modal="false" className="panel grid">
          <h3 style={{ margin: 0 }}>Konfirmasi drawing</h3>
          <div>
            Anda akan membuat drawing <strong>{drawRunKindLabel(kind)}</strong> dengan seed{' '}
            <code>{seed.trim()}</code> untuk <strong>{p.entries.eligible}</strong> peserta layak
            {p.entries.blocked > 0 ? ` (${p.entries.blocked} peserta diblokir tidak ikut)` : ''}.
          </div>
          {p.ruleSetLock && !p.ruleSetLock.lockable ? (
            <div className="banner banner-info">
              Set aturan masih provisional: hasil drawing ini belum dapat dikunci atau diterbitkan.
            </div>
          ) : null}
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting}
              onClick={() => void execute()}
            >
              {submitting ? 'Memproses…' : 'Konfirmasi dan jalankan'}
            </button>{' '}
            <button type="button" className="btn" disabled={submitting} onClick={() => setConfirming(false)}>
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {runId ? (
        run.error ? (
          <div className="banner banner-conflict" role="alert">
            Gagal memuat status drawing: {run.error.message}
          </div>
        ) : run.data ? (
          <RunStatus tournamentId={id} run={run.data} />
        ) : (
          <div className="state-loading" role="status">
            Memuat status drawing…
          </div>
        )
      ) : null}
    </main>
  );
}
