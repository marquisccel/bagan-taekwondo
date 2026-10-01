'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '../../../../lib/api';
import { useDevAuth } from '../../../../lib/dev-auth';
import { useApiSWR } from '../../../../lib/use-api-swr';

/**
 * A draw seed must be a decimal, unsigned-64-bit-integer string (see parseDrawSeed in
 * packages/shared/src/prng.ts) — never an arbitrary label like a tournament id. This derives one
 * deterministically from the slot's identity via FNV-1a 64-bit: re-clicking "Lihat Bagan" for the
 * same tournament/day/arena always reproduces the same seed, so the server can recognize it already
 * ran this slot and hand back the existing draw run instead of queuing a new one.
 */
function seedForSlot(tournamentId: string, dayNumber: number, arenaCode: string): string {
  const FNV_OFFSET = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK64 = (1n << 64n) - 1n;
  const input = `${tournamentId}|D${dayNumber}|${arenaCode}`;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString();
}

/** "2026-09-18" -> "Jumat, 18 September 2026" — the weekday is always computed from the stored
 * calendar date, never stored itself (see packages/intake/src/sps-workbook.ts). */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export default function JadwalPage() {
  const params = useParams<{ id: string }>();
  const auth = useDevAuth();
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: slots, error } = useApiSWR(auth.actorId ? ['schedule', params.id, auth.actorId] : null, () =>
    api.scheduleSlots(auth.actorId, params.id),
  );

  // Idempotent on the server (same seed -> same draw run), so this always goes straight to the
  // checking page: the page there polls status and, once ready, offers "Jelajahi kategori" itself.
  const openBagan = async (dayNumber: number, arenaCode: string) => {
    const key = `${dayNumber}-${arenaCode}`;
    setBusyKey(key);
    setErrors((e) => ({ ...e, [key]: '' }));
    try {
      const seed = seedForSlot(params.id, dayNumber, arenaCode);
      const res = await api.generateFromSchedule(auth.actorId, params.id, { dayNumber, arenaCode, seed });
      router.push(
        `/tournaments/${params.id}/draws/${res.drawRunId}?dayNumber=${dayNumber}&arenaCode=${encodeURIComponent(arenaCode)}`,
      );
    } catch (e) {
      setErrors((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));
      setBusyKey(null);
    }
  };

  if (error) {
    return (
      <main className="content state-empty">
        <p>Gagal memuat jadwal: {error.message}</p>
      </main>
    );
  }
  if (!slots) {
    return (
      <main className="content state-empty">
        <p>Memuat jadwal…</p>
      </main>
    );
  }
  if (slots.length === 0) {
    return (
      <main className="content state-empty">
        <p>Belum ada jadwal. Unggah SPS untuk memuat jadwal arena/hari.</p>
      </main>
    );
  }

  const byDay = new Map<number, typeof slots>();
  for (const s of slots) byDay.set(s.dayNumber, [...(byDay.get(s.dayNumber) ?? []), s]);

  return (
    <main className="content grid">
      <h1>Jadwal</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Pilih arena dan hari, lalu tekan Lihat Bagan. Sistem hanya menggambar kategori yang siap (peserta
        lengkap) untuk slot tersebut.
      </p>
      {[...byDay.entries()].map(([dayNumber, daySlots]) => (
        <section key={dayNumber} className="panel grid">
          <h2>
            DAY {dayNumber} · {formatDate(daySlots[0]?.date ?? '')}
          </h2>
          <table>
            <thead>
              <tr>
                <th>Arena</th>
                <th className="num">Jumlah Kategori</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daySlots.map((s) => {
                const key = `${s.dayNumber}-${s.arenaCode}`;
                const busy = busyKey === key;
                const errorMessage = errors[key];
                return (
                  <tr key={key}>
                    <td>Arena {s.arenaCode}</td>
                    <td className="num">{s.categoryCount}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void openBagan(s.dayNumber, s.arenaCode)}
                      >
                        {busy ? 'Membuka…' : 'Lihat Bagan'}
                      </button>
                      {errorMessage ? (
                        <span style={{ marginLeft: 8, color: 'var(--red)' }}>{errorMessage}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
