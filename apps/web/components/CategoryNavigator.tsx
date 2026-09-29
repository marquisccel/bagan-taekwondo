'use client';

import { useMemo, useState } from 'react';

import type { CategorySummary } from '../lib/api';
import { disciplineLabel, genderLabel, qualityIcon, streamLabel } from '../lib/id-labels';

/**
 * Left-hand category navigator for the Drawing workspace (UX slice 0, §14). Groups by
 * discipline + stream (the only two dimensions the category-list endpoint actually returns
 * translated fields for — see docs/UX_REDESIGN_AUDIT.md §29 Q3/§30: age-division and weight-class
 * labels are not part of this response, so this never guesses them from `category_key`). The raw
 * key is kept as a small secondary line so a category is still unambiguous to an operator who
 * needs to cross-reference it, without presenting it as the primary label.
 */
function groupKey(c: CategorySummary): string {
  return `${disciplineLabel(c.discipline)} ${streamLabel(c.stream)}`;
}

export function CategoryNavigator({
  categories,
  selectedCategoryId,
  onSelect,
}: {
  categories: readonly CategorySummary[];
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
}) {
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? categories.filter(
          (c) =>
            c.category_key.toLowerCase().includes(needle) ||
            genderLabel(c.gender).toLowerCase().includes(needle),
        )
      : categories;
    const map = new Map<string, CategorySummary[]>();
    for (const c of filtered) {
      const key = groupKey(c);
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return [...map.entries()];
  }, [categories, q]);

  return (
    <nav className="category-nav" aria-label="Kategori">
      <div className="category-nav-search">
        <input
          type="search"
          aria-label="Cari kategori"
          placeholder="Cari kategori…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="category-nav-list">
        {groups.length === 0 ? <div className="category-nav-empty">Tidak ada kategori.</div> : null}
        {groups.map(([label, items]) => (
          <div className="category-nav-group" key={label}>
            <div className="category-nav-group-label">{label}</div>
            {items.map((c) => {
              const active = c.category_id === selectedCategoryId;
              return (
                <button
                  key={c.category_id}
                  type="button"
                  className={`category-nav-item${active ? ' active' : ''}`}
                  onClick={() => onSelect(c.category_id)}
                  aria-current={active ? 'true' : undefined}
                  title={c.category_key}
                >
                  <span className="category-nav-item-label">
                    {genderLabel(c.gender)}
                    {c.movement ? ` · ${c.movement}` : ''}
                  </span>
                  <span className="category-nav-item-meta">
                    <span className="num">{c.entryCount}</span>
                    <span
                      className={`category-nav-dot dot-${c.quality.toLowerCase()}`}
                      title={c.quality}
                      aria-label={c.readiness === 'BLOCKED' ? 'Diblokir' : qualityIcon[c.quality]}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
