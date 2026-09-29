'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { uploadSps, type SpsUploadResult } from '../lib/api';
import { useDevAuth } from '../lib/dev-auth';

/**
 * The app's entry point: already connected (an earlier upload) -> straight to the dashboard, no
 * screen shown at all. Never connected yet -> upload the committee's SPS spreadsheet once; the
 * response bootstraps a brand-new tournament and this session's shared actor automatically (no
 * tournament id or user id ever typed by hand — see lib/dev-auth.tsx).
 */
export default function HomePage() {
  const { tournamentId, actorId, setTournament, setActor } = useDevAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpsUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tournamentId && actorId) router.replace(`/tournaments/${tournamentId}`);
  }, [tournamentId, actorId, router]);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadSps(crypto.randomUUID(), file);
      setResult(res);
      setActor(res.actorId);
      setTournament(res.tournamentId);
      setTimeout(() => router.push(`/tournaments/${res.tournamentId}`), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (tournamentId && actorId) return null;

  return (
    <main className="content" style={{ maxWidth: 560 }}>
      <h1>BaganTKD</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Unggah file SPS (jadwal &amp; peserta) untuk mulai. Sistem otomatis membuat turnamen baru dari data di
        dalamnya, tidak perlu isi apa pun secara manual.
      </p>

      <div
        className="panel grid"
        style={{
          borderStyle: 'dashed',
          borderWidth: 2,
          textAlign: 'center',
          padding: '2.5rem 1.5rem',
          cursor: busy ? 'default' : 'pointer',
        }}
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
        {busy ? (
          <p>Mengunggah dan memproses file…</p>
        ) : (
          <>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Klik atau seret file SPS (.xlsx) ke sini</p>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9em' }}>
              Sistem membaca tab &quot;semi-prestasi&quot; (peserta) dan &quot;Jadwal FIX&quot; (jadwal
              arena/hari).
            </p>
          </>
        )}
      </div>

      {error ? (
        <p className="panel" style={{ borderColor: 'var(--danger, #b33)', color: 'var(--danger, #b33)' }}>
          Gagal mengunggah: {error}
        </p>
      ) : null}

      {result ? (
        <div className="panel grid">
          <p style={{ fontWeight: 600 }}>Berhasil! Membuka dashboard…</p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9em' }}>
            {result.participantCount} peserta · {result.scheduleRowCount} baris jadwal ·{' '}
            {result.arenaCodes.length} arena
          </p>
          {result.scheduleIssues.length > 0 ? (
            <p style={{ color: '#7a4b00', fontSize: '0.9em' }}>
              {result.scheduleIssues.length} baris jadwal tidak dikenali sistem dan dilewati (bukan ditebak),
              biasanya kelas Prestasi atau Freestyle yang memang belum didukung sistem ini.
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
