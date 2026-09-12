import type { CategoryGender, Gender } from '@bagantkd/domain';
import type { CategoryTemplate, RuleSet } from '@bagantkd/rules';

/**
 * Category derivation (PHASE2_PLAN §7): a pure function of (entry facts, rule set). No category
 * count, name or grouping exists in code; everything comes from the rule set's templates.
 */
export interface CategoryInput {
  readonly stream: string | null;
  readonly discipline: string | null;
  readonly format: string;
  readonly divisionCode: string | null;
  readonly weightClass: string | null;
  readonly memberGenders: readonly (Gender | null)[];
  /** Member belts for movement derivation; every member must resolve to the same movement. */
  readonly memberBelts: readonly (string | null)[];
}

export type CategoryGap =
  'NO_CATEGORY_TEMPLATE' | 'UNKNOWN_CLASS' | 'MOVEMENT_UNRESOLVED' | 'CATEGORY_KEY_INCOMPLETE';

export interface DerivedCategory {
  readonly template: CategoryTemplate | null;
  readonly key: string | null;
  readonly gender: CategoryGender | null;
  readonly movement: string | null;
  readonly gaps: readonly CategoryGap[];
}

export function deriveCategory(
  input: CategoryInput,
  rs: RuleSet,
  hasRowClassIssue: boolean,
): DerivedCategory {
  const template =
    input.stream === null || input.discipline === null
      ? null
      : (rs.categoryTemplates.find(
          (t) => t.stream === input.stream && t.discipline === input.discipline && t.format === input.format,
        ) ?? null);
  if (template === null)
    return { template: null, key: null, gender: null, movement: null, gaps: ['NO_CATEGORY_TEMPLATE'] };

  const gaps: CategoryGap[] = [];
  const distinctGenders = [...new Set(input.memberGenders)];
  const gender: CategoryGender | null =
    template.genderMode === 'MIXED'
      ? 'MIXED'
      : distinctGenders.length === 1
        ? (distinctGenders[0] ?? null)
        : null;
  let movement: string | null = null;
  const parts: string[] = [template.code];
  let complete = true;

  for (const dim of template.dimensions) {
    let value: string | null;
    switch (dim) {
      case 'STREAM':
        value = input.stream;
        break;
      case 'DISCIPLINE':
        value = input.discipline;
        break;
      case 'FORMAT':
        value = input.format;
        break;
      case 'AGE_DIVISION':
        value = input.divisionCode;
        break;
      case 'GENDER':
        value = gender;
        break;
      case 'WEIGHT_CLASS':
        value = input.weightClass;
        // A row-level class issue already explains a missing class; otherwise it is a rule gap.
        if (value === null && !hasRowClassIssue) gaps.push('UNKNOWN_CLASS');
        break;
      case 'MOVEMENT': {
        const map = rs.movementMaps.find((m) => m.code === template.movementMapCode);
        const scheme = rs.beltBandSchemes.find((s) => s.code === map?.schemeCode);
        const moves = new Set(
          input.memberBelts.map((belt) => {
            const band = scheme?.bands.find((b) => belt !== null && b.beltCodes.includes(belt));
            return map?.entries.find((e) => e.bandCode === band?.code)?.movement ?? null;
          }),
        );
        movement = moves.size === 1 ? ([...moves][0] ?? null) : null;
        value = movement;
        if (value === null) gaps.push('MOVEMENT_UNRESOLVED');
        break;
      }
    }
    if (value === null) complete = false;
    parts.push(`${dim}=${value ?? ''}`);
  }
  if (!complete && gaps.length === 0) gaps.push('CATEGORY_KEY_INCOMPLETE');
  return { template, key: complete && gaps.length === 0 ? parts.join('|') : null, gender, movement, gaps };
}
