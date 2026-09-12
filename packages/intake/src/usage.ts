import type { CategoryTemplate, RuleSet } from '@bagantkd/rules';

export type UsedField = 'HEIGHT' | 'WEIGHT' | 'BELT';

/**
 * Whether a category template's draw uses a physical field (PHASE2_PLAN §4). A data problem in a
 * field the draw does not use is recorded as INFO, not ERROR: a missing height is irrelevant to a
 * prestasi bracket but disqualifying for semi-prestasi pooling.
 */
export function templateUses(rs: RuleSet, template: CategoryTemplate | null, field: UsedField): boolean {
  if (template === null) return false;
  if (field === 'BELT' && template.dimensions.includes('MOVEMENT')) return true;
  const policy = rs.poolPolicies.find((p) => p.code === template.poolPolicyCode);
  if (!policy) return false;
  if (field === 'BELT') return policy.belt.policy === 'HARD' || policy.belt.policy === 'SOFT';
  return policy.tolerances.some((t) => t.dimension === field && t.active && t.ageDivisionCode === null);
}

export function findTemplate(
  rs: RuleSet,
  stream: string | null,
  discipline: string | null,
  format: string,
): CategoryTemplate | null {
  if (stream === null || discipline === null) return null;
  return (
    rs.categoryTemplates.find(
      (t) => t.stream === stream && t.discipline === discipline && t.format === format,
    ) ?? null
  );
}
