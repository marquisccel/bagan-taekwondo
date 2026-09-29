'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BrandMark } from '../components/BrandMark';
import { previewSps, uploadSps, type SpsUploadPreview, type SpsUploadResult } from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';

type Stage = 'idle' | 'previewing' | 'reviewing' | 'committing' | 'done';

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V4m0 0-4 4m4-4 4 4M5 16v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The app's entry point: already connected (an earlier upload) -> straight to the dashboard, no
 * screen shown at all. Never connected yet -> upload the committee's SPS spreadsheet once.
 *
 * Two steps, not one: picking a file first PREVIEWS it (POST /uploads/sps/preview -- reads and
 * reports, writes nothing), so a wrong file, a renamed tab, or dirty participant data is caught and
 * shown before a tournament is ever created for it. Only once the committee reviews that summary and
 * presses "Lanjutkan" does the real commit (POST /uploads/sps) run, on the exact same `File` object.
 */
export default function HomePage() {
  const { tournamentId, actorId, setTournament, setActor } = useDevAuth();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpsUploadPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [result, setResult] = useState<SpsUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tournamentId && actorId) router.replace(`/tournaments/${tournamentId}`);
  }, [tournamentId, actorId, router]);

  const handleFile = async (file: File) => {
    setStage('previewing');
    setError(null);
    setPreview(null);
    setPendingFile(file);
    try {
      const p = await previewSps(crypto.randomUUID(), file);
      setPreview(p);
      setStage('reviewing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('idle');
    }
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setStage('committing');
    setError(null);
    try {
      const res = await uploadSps(crypto.randomUUID(), pendingFile);
      setResult(res);
      setActor(res.actorId);
      setTournament(res.tournamentId);
      setStage('done');
      setTimeout(() => router.push(`/tournaments/${res.tournamentId}`), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('reviewing');
    }
  };

  const pickDifferentFile = () => {
    setPreview(null);
    setPendingFile(null);
    setError(null);
    setStage('idle');
  };

  if (tournamentId && actorId) return null;

  const busy = stage === 'previewing' || stage === 'committing';
  const showDropzone = stage === 'idle' || stage === 'previewing';

  return (
    <main className="upload-hero">
      <div className="upload-hero-brand">
        <BrandMark size="hero" />
        <div>
          <h1>Taekwondo Indonesia</h1>
          <p className="upload-hero-eyebrow" style={{ marginTop: 4 }}>
            Unggah file SPS (jadwal &amp; peserta) untuk mulai. Sistem otomatis membuat bagan turnamen dari
            data di dalamnya — presisi, bisa diedit, tanpa perlu isi apa pun secara manual.
          </p>
        </div>
      </div>

      <div className="upload-card">
        {showDropzone ? (
          <div
            className={`upload-dropzone${busy ? ' busy' : ''}`}
            onClick={() => !busy && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && !busy) void handleFile(file);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <div className="upload-dropzone-icon">
              <UploadIcon />
            </div>
            {stage === 'previewing' ? (
              <p style={{ fontWeight: 600 }}>Memeriksa isi file…</p>
            ) : (
              <>
                <p style={{ fontWeight: 700, marginBottom: 6, fontSize: 14.5 }}>
                  Klik atau seret file SPS (.xlsx) ke sini
                </p>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.9em', maxWidth: 380, margin: '0 auto' }}>
                  Sistem otomatis mencari tab jadwal (nama mengandung &quot;Jadwal&quot; dan &quot;FIX&quot;)
                  dan tab peserta (&quot;semi-prestasi&quot;) — tidak perlu nama tab persis sama.
                </p>
              </>
            )}
          </div>
        ) : null}

        {error ? <div className="upload-note upload-note-danger">Gagal: {error}</div> : null}

        {(stage === 'reviewing' || stage === 'committing') && preview ? (
          <div className="panel grid" data-testid="sps-preview">
            <p style={{ fontWeight: 700, fontSize: 15 }}>{preview.tournamentName}</p>
            <p className="upload-preview-line">
              <span>{preview.participantCount} peserta</span>·<span>{preview.categoryCount} kategori</span>·
              <span>{preview.scheduleRowCount} baris jadwal</span>·
              <span>{preview.arenaCodes.length} arena</span>
              {preview.eventStart && preview.eventEnd ? (
                <span>
                  · {preview.eventStart} s.d. {preview.eventEnd}
                </span>
              ) : null}
            </p>

            {preview.participantIssueCounts.error > 0 || preview.participantIssueCounts.warning > 0 ? (
              <p className="upload-note upload-note-warning">
                {preview.participantIssueCounts.error > 0
                  ? `${preview.participantIssueCounts.error} data peserta bermasalah`
                  : null}
                {preview.participantIssueCounts.error > 0 && preview.participantIssueCounts.warning > 0
                  ? ', '
                  : null}
                {preview.participantIssueCounts.warning > 0
                  ? `${preview.participantIssueCounts.warning} peringatan`
                  : null}{' '}
                — bisa diperbaiki nanti di halaman Peserta setelah turnamen dibuat.
              </p>
            ) : null}

            {preview.scheduleIssues.length > 0 ? (
              <p className="upload-note upload-note-warning">
                {preview.scheduleIssues.length} baris jadwal tidak dikenali sistem dan akan dilewati (bukan
                ditebak), biasanya kelas Prestasi atau Freestyle yang memang belum didukung sistem ini.
              </p>
            ) : null}

            {!preview.ok ? (
              <div className="upload-note upload-note-danger">
                <p style={{ fontWeight: 700, margin: '0 0 4px' }}>Belum bisa dilanjutkan:</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="btn"
                onClick={pickDifferentFile}
                disabled={stage === 'committing'}
              >
                Pilih file lain
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmUpload()}
                disabled={!preview.ok || stage === 'committing'}
              >
                {stage === 'committing' ? 'Membuat turnamen…' : 'Lanjutkan & Buat Turnamen'}
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'done' && result ? (
          <div className="panel grid">
            <p style={{ fontWeight: 700 }}>Berhasil! Membuka dashboard…</p>
            <p className="upload-preview-line">
              <span>{result.participantCount} peserta</span>·
              <span>{result.scheduleRowCount} baris jadwal</span>·
              <span>{result.arenaCodes.length} arena</span>
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
