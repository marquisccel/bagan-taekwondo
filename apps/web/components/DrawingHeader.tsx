import type { CategorySummary } from '../lib/api';
import {
  ageDivisionLabel,
  categoryKeyDims,
  disciplineLabel,
  genderLabel,
  revisionLifecycleLabel,
  streamLabel,
  weightClassDisplayLabel,
} from '../lib/id-labels';
import { StatusBadge } from './StatusBadge';

/**
 * Compact header for the selected category inside the Drawing workspace (UX slice 0, §15). Shows
 * only real domain data — never an engine strategy name, fingerprint, or internal id.
 */
export function DrawingHeader({
  summary,
  lifecycle,
}: {
  summary: CategorySummary;
  lifecycle: string | null;
}) {
  const dims = categoryKeyDims(summary.category_key);
  const ageDivision = dims.get('AGE_DIVISION');
  const weightClass = dims.get('WEIGHT_CLASS');
  const isWeightClass = weightClass && !['INDIVIDUAL', 'PAIR', 'TEAM'].includes(weightClass);
  return (
    <header className="drawing-header">
      <div className="drawing-header-title">
        <h1>
          {disciplineLabel(summary.discipline)} {streamLabel(summary.stream)}
        </h1>
        <div className="drawing-header-sub" title={summary.category_key}>
          {[
            genderLabel(summary.gender),
            ageDivision ? ageDivisionLabel(ageDivision) : null,
            isWeightClass ? weightClassDisplayLabel(weightClass) : null,
            summary.movement,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="drawing-header-stats">
        <span>
          <span className="num">{summary.entryCount}</span> peserta
        </span>
        <span>
          <span className="num">{summary.poolCount}</span> pool
        </span>
        <StatusBadge quality={summary.quality} />
        {lifecycle ? <span className="badge badge-neutral">{revisionLifecycleLabel(lifecycle)}</span> : null}
      </div>
    </header>
  );
}
