import type { CategoryFilterState } from '../lib/category-filters';

const DISCIPLINES = ['', 'KYORUGI', 'POOMSAE'];
const READINESS = ['', 'READY', 'BLOCKED'];
const QUALITY = ['', 'GREEN', 'YELLOW', 'RED'];

const READINESS_LABEL: Record<string, string> = { READY: 'Siap', BLOCKED: 'Diblokir' };
const QUALITY_LABEL: Record<string, string> = {
  GREEN: 'Aman',
  YELLOW: 'Perlu Perhatian',
  RED: 'Tidak Dapat Diterapkan',
};

export function CategoryFilters({
  value,
  onChange,
}: {
  value: CategoryFilterState;
  onChange: (v: CategoryFilterState) => void;
}) {
  return (
    <div className="filters">
      <input
        aria-label="Cari kategori"
        placeholder="Cari kategori…"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
      />
      <select
        aria-label="Disiplin"
        value={value.discipline}
        onChange={(e) => onChange({ ...value, discipline: e.target.value })}
      >
        {DISCIPLINES.map((d) => (
          <option key={d} value={d}>
            {d ? d.charAt(0) + d.slice(1).toLowerCase() : 'Semua disiplin'}
          </option>
        ))}
      </select>
      <select
        aria-label="Kesiapan"
        value={value.readiness}
        onChange={(e) => onChange({ ...value, readiness: e.target.value })}
      >
        {READINESS.map((r) => (
          <option key={r} value={r}>
            {r ? READINESS_LABEL[r] : 'Semua kesiapan'}
          </option>
        ))}
      </select>
      <select
        aria-label="Kualitas"
        value={value.quality}
        onChange={(e) => onChange({ ...value, quality: e.target.value })}
      >
        {QUALITY.map((q) => (
          <option key={q} value={q}>
            {q ? QUALITY_LABEL[q] : 'Semua kualitas'}
          </option>
        ))}
      </select>
    </div>
  );
}
