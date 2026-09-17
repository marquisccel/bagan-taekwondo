import type { CategoryFilterState } from '../lib/category-filters';

const DISCIPLINES = ['', 'KYORUGI', 'POOMSAE'];
const READINESS = ['', 'READY', 'BLOCKED'];
const QUALITY = ['', 'GREEN', 'YELLOW', 'RED'];

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
        aria-label="Search category"
        placeholder="Search category key…"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
      />
      <select
        aria-label="Discipline"
        value={value.discipline}
        onChange={(e) => onChange({ ...value, discipline: e.target.value })}
      >
        {DISCIPLINES.map((d) => (
          <option key={d} value={d}>
            {d || 'All disciplines'}
          </option>
        ))}
      </select>
      <select
        aria-label="Readiness"
        value={value.readiness}
        onChange={(e) => onChange({ ...value, readiness: e.target.value })}
      >
        {READINESS.map((r) => (
          <option key={r} value={r}>
            {r || 'All readiness'}
          </option>
        ))}
      </select>
      <select
        aria-label="Quality"
        value={value.quality}
        onChange={(e) => onChange({ ...value, quality: e.target.value })}
      >
        {QUALITY.map((q) => (
          <option key={q} value={q}>
            {q || 'All quality'}
          </option>
        ))}
      </select>
    </div>
  );
}
