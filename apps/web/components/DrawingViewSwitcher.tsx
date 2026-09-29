export type DrawingView = 'pools' | 'bracket';

/**
 * Presentation-only toggle (UX slice 0, §16) — switches which existing view renders, never
 * recomputes or invents draw data.
 */
export function DrawingViewSwitcher({
  view,
  onChange,
}: {
  view: DrawingView;
  onChange: (v: DrawingView) => void;
}) {
  return (
    <div className="view-switcher" role="tablist" aria-label="Tampilan drawing">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'pools'}
        className={view === 'pools' ? 'active' : ''}
        onClick={() => onChange('pools')}
      >
        Pool &amp; Peserta
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'bracket'}
        className={view === 'bracket' ? 'active' : ''}
        onClick={() => onChange('bracket')}
      >
        Bagan Pertandingan
      </button>
    </div>
  );
}
