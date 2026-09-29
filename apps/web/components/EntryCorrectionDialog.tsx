'use client';

import { useMemo, useState } from 'react';

import { api, ApiClientError, type EntryListItem } from '../lib/api';
import { weightClassDisplayLabel } from '../lib/id-labels';
import { useApiSWR } from '../lib/use-api-swr';

interface DropdownOption {
  readonly code: string;
  readonly label: string;
}

/**
 * Keeps a dropdown honest: if the entry's current stored value doesn't match any option in the
 * rule set's own vocabulary -- exactly the messy-data situation this correction UI exists for --
 * show it anyway instead of silently hiding it behind whichever option happens to render first.
 * Only labelled "tidak dikenali" once the vocabulary has actually loaded -- while it's still
 * loading (or failed to load), every value would otherwise show that same alarming label for a
 * reason that has nothing to do with the value itself.
 */
function withCurrent(
  options: readonly DropdownOption[],
  current: string,
  vocabularyLoaded: boolean,
): readonly DropdownOption[] {
  if (!current || options.some((o) => o.code === current)) return options;
  return [
    { code: current, label: vocabularyLoaded ? `${current} (nilai saat ini, tidak dikenali)` : current },
    ...options,
  ];
}

/**
 * The direct action the team asked for: when Peserta shows a data problem, there must be a way to
 * fix it, not just read about it. Scoped to the fields that actually cause the issues we surface
 * here (weight/height/birthdate/belt/class) -- see the matching backend comment in
 * entry-inspection.controller.ts for why this stays INDIVIDUAL-entry-only. Sabuk/Divisi/Class are
 * dropdowns sourced from the tournament's own active rule set (never a hand-invented list), so a
 * correction can never introduce a belt/division/class the rule set doesn't actually define.
 */
export function EntryCorrectionDialog({
  entry,
  tournamentId,
  actorId,
  onClose,
  onSaved,
}: {
  entry: EntryListItem;
  tournamentId: string;
  actorId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const first = entry.members[0];
  const [fullName, setFullName] = useState(first?.fullName ?? '');
  const [gender, setGender] = useState(first?.gender ?? '');
  const [birthDate, setBirthDate] = useState(first?.birthDate ?? '');
  const [heightCm, setHeightCm] = useState(
    first?.heightMm !== null ? String((first?.heightMm ?? 0) / 10) : '',
  );
  const [weightKg, setWeightKg] = useState(
    first?.weightG !== null ? String((first?.weightG ?? 0) / 1000) : '',
  );
  const [contingent, setContingent] = useState(entry.contingent);
  const [beltCode, setBeltCode] = useState(first?.beltCode ?? '');
  const [ageDivision, setAgeDivision] = useState(entry.declared.ageDivision);
  const [weightClass, setWeightClass] = useState(entry.declared.weightClass ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: vocabulary,
    error: vocabularyError,
    isLoading: vocabularyLoading,
  } = useApiSWR(
    actorId && tournamentId ? ['rule-set-vocabulary', tournamentId, actorId] : null,
    () => api.ruleSetVocabulary(actorId, tournamentId),
  );
  const vocabularyLoaded = !!vocabulary;

  const beltOptions = useMemo(
    () =>
      withCurrent(
        (vocabulary?.belts ?? []).map((b) => ({ code: b.code, label: b.label })),
        beltCode ?? '',
        vocabularyLoaded,
      ),
    [vocabulary, vocabularyLoaded, beltCode],
  );
  const ageDivisionOptions = useMemo(
    () =>
      withCurrent(
        (vocabulary?.ageDivisions ?? []).map((a) => ({ code: a.code, label: a.label })),
        ageDivision,
        vocabularyLoaded,
      ),
    [vocabulary, vocabularyLoaded, ageDivision],
  );
  // Kyorugi weight classes differ by age division and gender, so this list depends on both --
  // matching the rule set's own (stream, ageDivisionCode, gender) scoping exactly.
  const weightClassOptions = useMemo(() => {
    const table = (vocabulary?.weightClassTables ?? []).find(
      (t) => t.ageDivisionCode === ageDivision && t.stream === entry.declared.stream && t.gender === gender,
    );
    const options = (table?.classes ?? []).map((c) => ({ code: c.code, label: weightClassDisplayLabel(c.code) }));
    return withCurrent(options, weightClass, vocabularyLoaded);
  }, [vocabulary, vocabularyLoaded, ageDivision, gender, entry.declared.stream, weightClass]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.correctEntry(actorId, tournamentId, entry.entryId, {
        fullName: fullName.trim() || null,
        gender: gender === 'MALE' || gender === 'FEMALE' ? gender : null,
        birthDate: birthDate.trim() || null,
        heightMm: heightCm.trim() ? Math.round(Number(heightCm) * 10) : null,
        weightG: weightKg.trim() ? Math.round(Number(weightKg) * 1000) : null,
        contingent: contingent.trim() || null,
        beltCode: beltCode.trim() || null,
        declaredAgeDivision: ageDivision.trim() || null,
        declaredClass: weightClass.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer inspector"
        role="dialog"
        aria-label="Perbaiki Data Peserta"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inspector-header">
          <h2 className="inspector-title" style={{ marginBottom: 0 }}>
            Perbaiki Data Peserta
          </h2>
          <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Tutup">
            Tutup
          </button>
        </div>

        {vocabularyError ? (
          <p style={{ color: 'var(--red)', fontSize: 12 }}>
            Gagal memuat daftar sabuk/divisi/class dari set aturan aktif ({vocabularyError.message}). Nilai
            saat ini tetap bisa disimpan, tapi pilihan lain belum tersedia sampai ini berhasil dimuat.
          </p>
        ) : vocabularyLoading ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>Memuat daftar sabuk/divisi/class…</p>
        ) : null}

        <section className="inspector-section grid" style={{ gap: 10 }}>
          <label>
            Nama
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label>
            Jenis Kelamin
            <select
              value={gender ?? ''}
              onChange={(e) => setGender(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">·</option>
              <option value="MALE">Putra</option>
              <option value="FEMALE">Putri</option>
            </select>
          </label>
          <label>
            Tanggal Lahir
            <input
              type="date"
              value={birthDate ?? ''}
              onChange={(e) => setBirthDate(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Tinggi Badan (cm)
            <input
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Berat Badan (kg)
            <input
              type="number"
              step="0.1"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Kontingen
            <input
              value={contingent}
              onChange={(e) => setContingent(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Sabuk
            <select
              value={beltCode ?? ''}
              onChange={(e) => setBeltCode(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">·</option>
              {beltOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Divisi
            <select
              value={ageDivision}
              onChange={(e) => setAgeDivision(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">·</option>
              {ageDivisionOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Class / kelas berat
            <select
              value={weightClass}
              onChange={(e) => setWeightClass(e.target.value)}
              style={{ width: '100%' }}
              disabled={weightClassOptions.length === 0}
            >
              <option value="">·</option>
              {weightClassOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            {weightClassOptions.length === 0 ? (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Pilih Divisi (dan Jenis Kelamin) dahulu untuk melihat pilihan class.
              </span>
            ) : null}
          </label>
        </section>

        {error ? <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p> : null}

        <div className="inspector-actions">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Batal
          </button>
        </div>
      </aside>
    </div>
  );
}
