import type { Discipline, EntryFormat, IssueCode, IssueSeverity, Stream } from '@bagantkd/domain';
import type { RuleSet } from '@bagantkd/rules';

import {
  decodeNik,
  normalizeBelt,
  normalizeClassification,
  normalizeContingent,
  normalizeDate,
  normalizeDivision,
  normalizeGender,
  normalizeHeightMm,
  normalizeName,
  normalizeNik,
  normalizeWeightG,
  parseWeightClass,
  vocabularyKey,
} from './normalize.js';
import type { IntakeIssue, NormalizedRow, RuleRef, SourceRecord, Suggestion, Trace } from './types.js';
import { findTemplate, templateUses, type UsedField } from './usage.js';

/** Source adapter for the 2026 registration export (13 columns, SOURCE_ANALYSIS F-02). */
export const KOLEKTIF_2026_COLUMNS = [
  'id_athlete',
  'nama_tim',
  'nik',
  'namalengkap',
  'jeniskelamin',
  'tanggallahir',
  'tinggibadan',
  'beratbadan',
  'sabuk',
  'klasifikasi',
  'divisi',
  'class',
  'tim_kontingen',
] as const;

const ENG = 'ENGINEERING_DEFAULT' as const;

const issue = (
  code: IssueCode,
  severity: IssueSeverity,
  ref: string,
  rule: RuleRef,
  extra: Partial<Pick<IntakeIssue, 'component' | 'field' | 'raw' | 'suggestion' | 'params'>> = {},
): IntakeIssue => ({
  code,
  component: extra.component ?? null,
  severity,
  subject: { kind: 'ROW', ref },
  field: extra.field ?? null,
  raw: extra.raw ?? null,
  suggestion: extra.suggestion ?? null,
  rule,
  params: extra.params ?? {},
});

/**
 * Normalizes and validates one source row. Pure; issues carry severity already resolved by the
 * row's category template (severity by usage, PHASE2_PLAN §4).
 */
export function processRow(
  record: SourceRecord,
  rs: RuleSet,
  duplicateIds: ReadonlySet<string>,
): NormalizedRow {
  const raw = (col: (typeof KOLEKTIF_2026_COLUMNS)[number]) => record.raw[col] ?? '';
  const issues: IntakeIssue[] = [];
  const ref = raw('id_athlete').trim();
  // Row reference: the source id when unique; otherwise disambiguated by row number so no two
  // rows ever share a reference (duplicates are still reported).
  const rowRef =
    ref === '' ? `ROWNUM:${record.rowNumber}` : duplicateIds.has(ref) ? `${ref}@${record.rowNumber}` : ref;

  const sourceId: Trace<string> = {
    raw: raw('id_athlete'),
    value: ref === '' ? null : ref,
    outcome: ref === '' ? 'INVALID' : ref === raw('id_athlete') ? 'UNCHANGED' : 'NORMALIZED',
    rule: { code: 'SOURCE_ID', provenance: ENG },
    suggestion: null,
  };
  if (ref === '' || duplicateIds.has(ref)) {
    issues.push(
      issue('DUPLICATE_SOURCE_ID', 'ERROR', rowRef, sourceId.rule, {
        field: 'id_athlete',
        raw: raw('id_athlete'),
      }),
    );
  }

  const name = normalizeName(raw('namalengkap'));
  if (name.value === null)
    issues.push(issue('NAME_MISSING', 'ERROR', rowRef, name.rule, { field: 'namalengkap', raw: name.raw }));

  const gender = normalizeGender(raw('jeniskelamin'), rs);
  if (gender.value === null)
    issues.push(
      issue('UNKNOWN_GENDER', 'ERROR', rowRef, gender.rule, { field: 'jeniskelamin', raw: gender.raw }),
    );

  const birthDate = normalizeDate(raw('tanggallahir'));
  const birthYear = birthDate.value === null ? null : Number(birthDate.value.slice(0, 4));
  if (birthDate.value === null) {
    issues.push(
      issue('INVALID_DATE', 'ERROR', rowRef, birthDate.rule, { field: 'tanggallahir', raw: birthDate.raw }),
    );
  } else if (birthDate.value.endsWith('-01-01')) {
    issues.push(
      issue('DOB_POSSIBLE_PLACEHOLDER', 'INFO', rowRef, birthDate.rule, {
        field: 'tanggallahir',
        raw: birthDate.raw,
      }),
    );
  }

  const height = normalizeHeightMm(raw('tinggibadan'));
  const weight = normalizeWeightG(raw('beratbadan'));

  const belt = normalizeBelt(raw('sabuk'), rs);
  if (belt.value === null)
    issues.push(issue('UNKNOWN_BELT', 'ERROR', rowRef, belt.rule, { field: 'sabuk', raw: belt.raw }));

  const classification = normalizeClassification(raw('klasifikasi'), rs);
  const [stream, discipline] = (classification.value?.split(':') ?? [null, null]) as [
    Stream | null,
    Discipline | null,
  ];
  if (classification.value === null) {
    issues.push(
      issue('UNKNOWN_CLASSIFICATION', 'ERROR', rowRef, classification.rule, {
        field: 'klasifikasi',
        raw: classification.raw,
      }),
    );
  }

  let division = normalizeDivision(raw('divisi'), rs);
  const divisionDef = rs.ageDivisions.find((d) => d.code === division.value) ?? null;
  if (
    division.value !== null &&
    stream !== null &&
    divisionDef !== null &&
    !divisionDef.streams.includes(stream)
  ) {
    division = { ...division, value: null, outcome: 'INVALID' };
  }
  if (division.value === null) {
    issues.push(
      issue('UNKNOWN_DIVISION', 'ERROR', rowRef, division.rule, {
        field: 'divisi',
        raw: division.raw,
        params: { stream },
      }),
    );
  }

  // class column: either an entry format (poomsae/freestyle) or a Kyorugi weight class.
  const classRaw = raw('class');
  const vocabRule: RuleRef = { code: 'VOCAB_FORMAT', provenance: rs.sourceVocabulary.provenance.source };
  const formatKey = Object.entries(rs.sourceVocabulary.format).find(
    ([k]) => vocabularyKey(k) === vocabularyKey(classRaw),
  );
  let format: EntryFormat = 'INDIVIDUAL';
  let weightClass: string | null = null;
  let classOrFormat: Trace<string>;
  if (formatKey) {
    format = formatKey[1];
    classOrFormat = { raw: classRaw, value: format, outcome: 'MAPPED', rule: vocabRule, suggestion: null };
  } else {
    const parsed = parseWeightClass(classRaw);
    const table =
      stream !== null && division.value !== null && gender.value !== null
        ? (rs.weightClassTables.find(
            (t) => t.stream === stream && t.ageDivisionCode === division.value && t.gender === gender.value,
          ) ?? null)
        : null;
    const formatRule: RuleRef = { code: 'WEIGHT_CLASS_FORMAT', provenance: ENG };
    if (parsed.kind === 'CANONICAL') {
      weightClass = parsed.code;
      classOrFormat = {
        raw: classRaw,
        value: parsed.code,
        outcome: parsed.changed ? 'NORMALIZED' : 'UNCHANGED',
        rule: formatRule,
        suggestion: null,
      };
      if (parsed.changed) {
        issues.push(
          issue('CLASS_FORMAT_NORMALIZED', 'INFO', rowRef, formatRule, {
            field: 'class',
            raw: classRaw,
            params: { normalized: parsed.code },
          }),
        );
      }
      const known =
        discipline === 'KYORUGI' && table !== null && table.classes.some((c) => c.code === parsed.code);
      if (!known) {
        weightClass = null;
        issues.push(
          issue(
            'UNKNOWN_CLASS',
            'ERROR',
            rowRef,
            { code: 'WEIGHT_CLASS_TABLE', provenance: table?.provenance.source ?? 'TBD' },
            {
              field: 'class',
              raw: classRaw,
              params: { normalized: parsed.code, tableCompleteness: table?.completeness ?? null },
            },
          ),
        );
      }
    } else if (parsed.kind === 'AMBIGUOUS') {
      const alternatives = [`-${parsed.digits}`, `+${parsed.digits}`]
        .filter((c) => table?.classes.some((x) => x.code === c) ?? false)
        .map((c) => ({ class: c }));
      const suggestion: Suggestion | null =
        alternatives.length > 0 ? { rule: 'FORMULA_CORRUPTED_CLASS_CANDIDATES', alternatives } : null;
      classOrFormat = { raw: classRaw, value: null, outcome: 'INVALID', rule: formatRule, suggestion };
      issues.push(
        issue('AMBIGUOUS_WEIGHT_CLASS', 'ERROR', rowRef, formatRule, {
          field: 'class',
          raw: classRaw,
          suggestion,
        }),
      );
    } else {
      classOrFormat = { raw: classRaw, value: null, outcome: 'INVALID', rule: formatRule, suggestion: null };
      issues.push(issue('UNKNOWN_CLASS', 'ERROR', rowRef, formatRule, { field: 'class', raw: classRaw }));
    }
  }

  const nik = normalizeNik(raw('nik'));
  if (nik.trace.outcome === 'NORMALIZED') {
    issues.push(issue('NIK_NORMALIZED', 'INFO', rowRef, nik.trace.rule, { field: 'nik' }));
  }
  if (nik.trace.value === '') {
    issues.push(issue('NIK_MISSING', 'WARNING', rowRef, nik.trace.rule, { field: 'nik' }));
  } else if (!nik.valid16) {
    issues.push(
      issue(
        'NIK_INVALID_FORMAT',
        'WARNING',
        rowRef,
        { code: 'NIK_16_DIGITS', provenance: ENG },
        { field: 'nik', params: { length: (nik.trace.value ?? '').length } },
      ),
    );
  } else {
    const decoded = decodeNik(nik.trace.value ?? '');
    const nikRule: RuleRef = { code: 'NIK_ENCODED_DDMMYY', provenance: ENG };
    if (gender.value !== null && decoded.gender !== gender.value) {
      issues.push(
        issue('NIK_GENDER_MISMATCH', 'WARNING', rowRef, nikRule, {
          field: 'jeniskelamin',
          params: { nikGender: decoded.gender },
        }),
      );
    }
    if (birthDate.value !== null && birthYear !== null) {
      const [, m, d] = birthDate.value.split('-').map(Number);
      if (decoded.yy !== birthYear % 100) {
        issues.push(
          issue('NIK_BIRTHDATE_MISMATCH', 'WARNING', rowRef, nikRule, {
            component: 'YEAR',
            field: 'tanggallahir',
          }),
        );
      } else if (decoded.day !== d || decoded.month !== m) {
        issues.push(
          issue('NIK_BIRTHDATE_MISMATCH', 'WARNING', rowRef, nikRule, {
            component: 'DAY_MONTH',
            field: 'tanggallahir',
          }),
        );
      }
    }
  }

  const contingent = normalizeContingent(raw('tim_kontingen'));
  if (normalizeContingent(raw('nama_tim')).value !== contingent.value) {
    issues.push(issue('CONTINGENT_FIELDS_DIFFER', 'WARNING', rowRef, contingent.rule, { field: 'nama_tim' }));
  }

  // Physical plausibility, severity by usage.
  const template = findTemplate(rs, stream, discipline, format);
  const usageSeverity = (...fields: UsedField[]): IssueSeverity =>
    fields.some((f) => templateUses(rs, template, f)) ? 'ERROR' : 'INFO';
  const pl = rs.plausibility;
  const plRule: RuleRef = { code: 'PLAUSIBILITY', provenance: pl.provenance.source };
  const h = height.value;
  const w = weight.value;
  if (height.missing)
    issues.push(
      issue('HEIGHT_MISSING', usageSeverity('HEIGHT'), rowRef, height.rule, {
        field: 'tinggibadan',
        raw: height.raw,
      }),
    );
  else if (h === null) {
    issues.push(
      issue('INVALID_NUMBER', usageSeverity('HEIGHT'), rowRef, height.rule, {
        component: 'HEIGHT',
        field: 'tinggibadan',
        raw: height.raw,
      }),
    );
  }
  if (weight.missing)
    issues.push(
      issue('WEIGHT_MISSING', usageSeverity('WEIGHT'), rowRef, weight.rule, {
        field: 'beratbadan',
        raw: weight.raw,
      }),
    );
  else if (w === null) {
    issues.push(
      issue('INVALID_NUMBER', usageSeverity('WEIGHT'), rowRef, weight.rule, {
        component: 'WEIGHT',
        field: 'beratbadan',
        raw: weight.raw,
      }),
    );
  }

  const hOk = h !== null && h >= pl.heightMm.min && h <= pl.heightMm.max;
  const wOk = w !== null && w >= pl.weightG.min && w <= pl.weightG.max;
  let swapped = false;
  if (h !== null && w !== null && (!hOk || !wOk)) {
    // weight read as cm is a plausible height, height read as kg is a plausible weight
    if (
      w >= pl.heightMm.min * 100 &&
      w <= pl.heightMm.max * 100 &&
      h * 100 >= pl.weightG.min &&
      h * 100 <= pl.weightG.max
    ) {
      swapped = true;
      const suggestion: Suggestion = {
        rule: 'SWAP_HEIGHT_WEIGHT',
        // Exchange the two raw strings: exact, no unit arithmetic, nothing lost.
        alternatives: [{ tinggibadan: weight.raw, beratbadan: height.raw }],
      };
      issues.push(
        issue('HEIGHT_WEIGHT_LIKELY_SWAPPED', usageSeverity('HEIGHT', 'WEIGHT'), rowRef, plRule, {
          field: 'tinggibadan',
          raw: `${height.raw}|${weight.raw}`,
          suggestion,
          params: { declaredClass: weightClass },
        }),
      );
    }
  }
  if (!swapped) {
    if (h !== null && !hOk)
      issues.push(
        issue('HEIGHT_OUT_OF_RANGE', usageSeverity('HEIGHT'), rowRef, plRule, {
          field: 'tinggibadan',
          raw: height.raw,
        }),
      );
    if (w !== null && !wOk)
      issues.push(
        issue('WEIGHT_OUT_OF_RANGE', usageSeverity('WEIGHT'), rowRef, plRule, {
          field: 'beratbadan',
          raw: weight.raw,
        }),
      );
  }
  if (hOk && wOk && h !== null && w !== null) {
    const hh = BigInt(h) * BigInt(h);
    const scaled = BigInt(w) * 10000n;
    if (scaled < BigInt(pl.bmiTenths.min) * hh || scaled > BigInt(pl.bmiTenths.max) * hh) {
      issues.push(issue('BMI_IMPLAUSIBLE', 'WARNING', rowRef, plRule, { field: 'beratbadan' }));
    }
  }
  const heightUsable = hOk && !swapped;
  const weightUsable = wOk && !swapped;

  // Registered weight vs declared class (Kyorugi, usable weight only).
  if (discipline === 'KYORUGI' && weightClass !== null && weightUsable && w !== null) {
    const table = rs.weightClassTables.find(
      (t) => t.stream === stream && t.ageDivisionCode === division.value && t.gender === gender.value,
    );
    const cls = table?.classes.find((c) => c.code === weightClass);
    if (
      table &&
      cls &&
      ((cls.lowerExclusiveG !== null && w <= cls.lowerExclusiveG) ||
        (cls.upperInclusiveG !== null && w > cls.upperInclusiveG))
    ) {
      issues.push(
        issue(
          'WEIGHT_CLASS_MISMATCH',
          'WARNING',
          rowRef,
          { code: 'WEIGHT_CLASS_TABLE', provenance: table.provenance.source },
          {
            field: 'beratbadan',
            params: { declaredClass: weightClass, tableCompleteness: table.completeness },
          },
        ),
      );
    }
  }

  // Age division against the declared division (policy BIRTH_YEAR).
  if (birthYear !== null && divisionDef !== null && division.value !== null && stream !== null) {
    const d = divisionDef;
    if (birthYear > d.maxBirthYear || birthYear < d.minBirthYear) {
      const containing = rs.ageDivisions.filter(
        (x) => x.streams.includes(stream) && x.minBirthYear <= birthYear && birthYear <= x.maxBirthYear,
      );
      const only = containing.length === 1 ? containing[0] : undefined;
      const ageRule: RuleRef = { code: 'AGE_BIRTH_YEAR_BAND', provenance: d.provenance.source };
      const playUpAllowed =
        d.playUp === 'ALLOW_WITH_WARNING' || d.playUp === 'ALLOW_ONE_DIVISION_WITH_WARNING';
      if (birthYear > d.maxBirthYear && only !== undefined && d.order - only.order === 1 && playUpAllowed) {
        issues.push(
          issue('AGE_DIVISION_PLAY_UP', 'WARNING', rowRef, ageRule, {
            field: 'tanggallahir',
            params: { declared: d.code, byBirthYear: only.code },
          }),
        );
      } else {
        issues.push(
          issue('AGE_DIVISION_CONFLICT', 'ERROR', rowRef, ageRule, {
            field: 'tanggallahir',
            params: { declared: d.code, byBirthYear: only?.code ?? null },
          }),
        );
      }
    }
  }

  return {
    rowNumber: record.rowNumber,
    ref: rowRef,
    fields: {
      sourceId,
      name,
      gender,
      birthDate,
      heightMm: height,
      weightG: weight,
      belt,
      classification,
      division,
      classOrFormat,
      nik: nik.trace,
      contingent,
    },
    stream,
    discipline,
    format,
    weightClass,
    templateCode: template?.code ?? null,
    heightUsable,
    weightUsable,
    birthYear,
    issues,
  };
}
