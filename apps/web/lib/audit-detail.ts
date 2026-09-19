import { impactCodeLabel } from './impact-labels';

/** Operator-facing detail of an audit event: the recorded quality verdict of a move/swap, or a supersede. */
export function auditDetail(action: string, after: unknown): string | null {
  const a = (after ?? {}) as { verdict?: string; violations?: string[]; supersededBy?: string };
  if (action === 'LIFECYCLE_SUPERSEDE')
    return `Digantikan oleh revisi ${a.supersededBy?.slice(0, 8) ?? ''}`.trim();
  if (a.verdict === 'GREEN') return 'Kualitas: tidak menurun';
  if (a.verdict === 'YELLOW')
    return `Kualitas menurun: ${(a.violations ?? []).map(impactCodeLabel).join('; ')}`;
  return null;
}
