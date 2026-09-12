import { compareStrings, sortedBy } from '@bagantkd/shared';

import type { ConflictField, IntakeIssue, NormalizedRow, Person } from './types.js';

/**
 * Entity resolution (PHASE2_PLAN §5). A person is identified by the normalized NIK string when
 * present — even an invalid-format NIK is a stable identifier within one export — otherwise by
 * the row. Attributes are adopted only when every row agrees; disagreement is surfaced, never
 * resolved by picking one. Persons are never merged on name similarity.
 */
export function resolvePersons(rows: readonly NormalizedRow[]): { persons: Person[]; issues: IntakeIssue[] } {
  const byKey = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    const nik = r.fields.nik.value;
    const key = nik !== null && nik !== '' ? `NIK:${nik}` : `ROW:${r.ref}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const persons: Person[] = [];
  const issues: IntakeIssue[] = [];
  for (const [key, members] of byKey) {
    const refs = sortedBy(
      members.map((m) => m.ref),
      compareStrings,
    );
    const one = <T>(values: readonly T[]): { value: T | null; conflict: boolean } => {
      const distinct = [...new Set(values.map((v) => JSON.stringify(v)))];
      return distinct.length === 1
        ? { value: values[0] ?? null, conflict: false }
        : { value: null, conflict: true };
    };
    const name = one(members.map((m) => (m.fields.name.value ?? '').toLowerCase()));
    const gender = one(members.map((m) => m.fields.gender.value));
    const dob = one(members.map((m) => m.fields.birthDate.value));
    const height = one(members.map((m) => m.fields.heightMm.value));
    const weight = one(members.map((m) => m.fields.weightG.value));
    const belt = one(members.map((m) => m.fields.belt.value));
    const conflicts: ConflictField[] = [];
    if (name.conflict) conflicts.push('FULL_NAME');
    if (gender.conflict) conflicts.push('GENDER');
    if (dob.conflict) conflicts.push('BIRTH_DATE');
    if (height.conflict) conflicts.push('HEIGHT');
    if (weight.conflict) conflicts.push('WEIGHT');
    if (belt.conflict) conflicts.push('BELT');
    const contingents = sortedBy(
      [...new Set(members.map((m) => m.fields.contingent.value ?? ''))],
      compareStrings,
    );

    // The person's usable measurements: usable in every row, else unknown.
    const usableHeight = members.every((m) => m.heightUsable) && !height.conflict ? height.value : null;
    const usableWeight = members.every((m) => m.weightUsable) && !weight.conflict ? weight.value : null;

    const person: Person = {
      key,
      ref: `P:${refs[0] ?? key}`,
      rowRefs: refs,
      gender: gender.value ?? null,
      birthYear: dob.value === null ? null : Number(dob.value.slice(0, 4)),
      heightMm: usableHeight,
      weightG: usableWeight,
      beltCode: belt.value,
      conflicts,
      contingents,
    };
    persons.push(person);
    if (conflicts.length > 0) {
      issues.push({
        code: 'ATHLETE_ATTRIBUTE_CONFLICT',
        component: null,
        severity: 'ERROR',
        subject: { kind: 'PERSON', ref: person.ref },
        field: conflicts.join(','),
        raw: null,
        suggestion: null,
        rule: { code: 'PERSON_ATTRIBUTES_AGREE', provenance: 'ENGINEERING_DEFAULT' },
        params: { fields: conflicts.join(','), rows: refs.join(',') },
      });
    }
    if (contingents.length > 1) {
      issues.push({
        code: 'ATHLETE_MULTIPLE_CONTINGENTS',
        component: null,
        severity: 'INFO',
        subject: { kind: 'PERSON', ref: person.ref },
        field: 'tim_kontingen',
        raw: null,
        suggestion: null,
        rule: { code: 'CONTINGENT_PER_ENTRY', provenance: 'EVIDENCE_2026' },
        params: { contingents: contingents.length },
      });
    }
  }

  // Same name and birth date under different keys: flag, never merge.
  const rowByRef = new Map(rows.map((r) => [r.ref, r]));
  const byNameDob = new Map<string, Person[]>();
  for (const p of persons) {
    const first = rowByRef.get(p.rowRefs[0] ?? '');
    const k = `${(first?.fields.name.value ?? '').toLowerCase()}|${first?.fields.birthDate.value ?? ''}`;
    byNameDob.set(k, [...(byNameDob.get(k) ?? []), p]);
  }
  for (const group of byNameDob.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        issues.push({
          code: 'POSSIBLE_DUPLICATE_PERSON',
          component: null,
          severity: 'WARNING',
          subject: { kind: 'PERSON', ref: group[i]?.ref ?? '' },
          field: null,
          raw: null,
          suggestion: null,
          rule: { code: 'SAME_NAME_AND_BIRTH_DATE', provenance: 'ENGINEERING_DEFAULT' },
          params: { other: group[j]?.ref ?? '' },
        });
      }
    }
  }
  return { persons: sortedBy(persons, (a, b) => compareStrings(a.ref, b.ref)), issues };
}
