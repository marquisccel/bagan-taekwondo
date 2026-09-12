import type { Gender } from '@bagantkd/domain';
import type { RuleSet } from '@bagantkd/rules';

import type { Outcome, ProvenanceSource, RuleRef, Suggestion, Trace } from './types.js';

/**
 * Field normalizers (PHASE2_PLAN §3). Each is pure, keeps `raw` byte-for-byte, and names the
 * rule and provenance behind its result. None of them changes meaning; anything that would is a
 * suggestion.
 */

const ENG: ProvenanceSource = 'ENGINEERING_DEFAULT';

const trace = <T>(
  raw: string,
  value: T | null,
  outcome: Outcome,
  rule: RuleRef,
  suggestion: Suggestion | null = null,
): Trace<T> => ({
  raw,
  value,
  outcome,
  rule,
  suggestion,
});

/** Trim and collapse internal whitespace. */
export const collapseWhitespace = (s: string): string => s.trim().replace(/\s+/g, ' ');

/** Key normalization for vocabulary lookups: whitespace collapsed, upper-cased. */
export const vocabularyKey = (s: string): string => collapseWhitespace(s).toUpperCase();

export function normalizeName(raw: string): Trace<string> {
  const value = collapseWhitespace(raw);
  if (value === '') return trace<string>(raw, null, 'INVALID', { code: 'NAME_REQUIRED', provenance: ENG });
  return value === raw
    ? trace(raw, value, 'UNCHANGED', { code: 'NAME_AS_GIVEN', provenance: ENG })
    : trace(raw, value, 'NORMALIZED', { code: 'NAME_WHITESPACE', provenance: ENG });
}

export function normalizeContingent(raw: string): Trace<string> {
  const value = collapseWhitespace(raw);
  return value === raw
    ? trace(raw, value, 'UNCHANGED', { code: 'CONTINGENT_AS_GIVEN', provenance: ENG })
    : trace(raw, value, 'NORMALIZED', { code: 'CONTINGENT_WHITESPACE', provenance: ENG });
}

function vocabulary<T>(raw: string, table: Readonly<Record<string, T>>, rule: RuleRef): Trace<T> {
  const key = vocabularyKey(raw);
  for (const [k, v] of Object.entries(table)) {
    if (vocabularyKey(k) === key) return trace(raw, v, 'MAPPED', rule);
  }
  return trace<T>(raw, null, 'INVALID', rule);
}

export const normalizeGender = (raw: string, rs: RuleSet): Trace<Gender> =>
  vocabulary(raw, rs.sourceVocabulary.gender, {
    code: 'VOCAB_GENDER',
    provenance: rs.sourceVocabulary.provenance.source,
  });

export const normalizeDivision = (raw: string, rs: RuleSet): Trace<string> =>
  vocabulary(raw, rs.sourceVocabulary.divisi, {
    code: 'VOCAB_DIVISION',
    provenance: rs.sourceVocabulary.provenance.source,
  });

/** Classification → "STREAM:DISCIPLINE". */
export function normalizeClassification(raw: string, rs: RuleSet): Trace<string> {
  const t = vocabulary(raw, rs.sourceVocabulary.klasifikasi, {
    code: 'VOCAB_CLASSIFICATION',
    provenance: rs.sourceVocabulary.provenance.source,
  });
  return { ...t, value: t.value === null ? null : `${t.value.stream}:${t.value.discipline}` };
}

export function normalizeBelt(raw: string, rs: RuleSet): Trace<string> {
  const key = vocabularyKey(raw);
  const rule: RuleRef = { code: 'BELT_SOURCE_LABEL', provenance: 'EVIDENCE_2026' };
  for (const b of rs.belts) {
    if (b.sourceLabels.some((l) => vocabularyKey(l) === key)) return trace(raw, b.code, 'MAPPED', rule);
  }
  return trace<string>(raw, null, 'INVALID', rule);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Strict ISO date `YYYY-MM-DD` that exists on the calendar. */
export function normalizeDate(raw: string): Trace<string> {
  const rule: RuleRef = { code: 'ISO_DATE', provenance: ENG };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return trace<string>(raw, null, 'INVALID', rule);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const max = mo === 2 && isLeap(y) ? 29 : (DAYS_IN_MONTH[mo - 1] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > max) return trace<string>(raw, null, 'INVALID', rule);
  const value = `${m[1]}-${m[2]}-${m[3]}`;
  return trace(raw, value, value === raw ? 'UNCHANGED' : 'NORMALIZED', rule);
}

/**
 * Decimal string (dot or comma) → integer in 10^-scale units, rounding half up when the input is
 * more precise than the unit. 0 or empty → value null (missing). Pure string/BigInt arithmetic.
 */
export function normalizeDecimal(
  raw: string,
  scale: number,
  unitRule: string,
): Trace<number> & { readonly missing: boolean } {
  const t = raw.trim().replaceAll(',', '.');
  const invalid = {
    ...trace<number>(raw, null, 'INVALID', { code: `${unitRule}_INVALID`, provenance: ENG }),
    missing: false,
  };
  if (t === '')
    return {
      ...trace<number>(raw, null, 'INVALID', { code: `${unitRule}_MISSING`, provenance: ENG }),
      missing: true,
    };
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return invalid;
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  const kept = frac.slice(0, scale).padEnd(scale, '0');
  const rest = frac.slice(scale);
  let value = BigInt(whole) * 10n ** BigInt(scale) + BigInt(kept === '' ? '0' : kept);
  const exact = /^0*$/.test(rest);
  if (!exact && Number(rest[0]) >= 5) value += 1n;
  if (value === 0n)
    return {
      ...trace<number>(raw, null, 'INVALID', { code: `${unitRule}_MISSING`, provenance: ENG }),
      missing: true,
    };
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return invalid;
  return exact
    ? { ...trace(raw, Number(value), 'UNCHANGED', { code: unitRule, provenance: ENG }), missing: false }
    : {
        ...trace(raw, Number(value), 'NORMALIZED', { code: `${unitRule}_ROUNDED`, provenance: ENG }),
        missing: false,
      };
}

export const normalizeHeightMm = (raw: string) => normalizeDecimal(raw, 1, 'HEIGHT_CM_TO_MM');
export const normalizeWeightG = (raw: string) => normalizeDecimal(raw, 3, 'WEIGHT_KG_TO_G');

export type WeightClassParse =
  | { readonly kind: 'CANONICAL'; readonly code: string; readonly changed: boolean }
  | { readonly kind: 'AMBIGUOUS'; readonly digits: string }
  | { readonly kind: 'UNKNOWN' };

/**
 * Weight-class code variants: `-NN`, `+NN` (canonical); `=+NN`, `=-NN` (spreadsheet formula
 * prefix), `NN+`, Unicode minus. A bare `NN` is the result of a spreadsheet evaluating `=+NN`
 * (SOURCE_ANALYSIS F-37) or of a lost `-`: ambiguous, never guessed.
 */
export function parseWeightClass(raw: string): WeightClassParse {
  const UNICODE_MINUS = String.fromCharCode(0x2212);
  const t = raw.trim().replaceAll(UNICODE_MINUS, '-');
  if (/^[-+]\d+$/.test(t)) return { kind: 'CANONICAL', code: t, changed: t !== raw };
  const prefixed = /^=([-+])(\d+)$/.exec(t);
  if (prefixed) return { kind: 'CANONICAL', code: `${prefixed[1] ?? ''}${prefixed[2] ?? ''}`, changed: true };
  const suffixed = /^(\d+)\+$/.exec(t);
  if (suffixed) return { kind: 'CANONICAL', code: `+${suffixed[1] ?? ''}`, changed: true };
  if (/^\d+$/.test(t)) return { kind: 'AMBIGUOUS', digits: t };
  return { kind: 'UNKNOWN' };
}

export interface NikNormalization {
  readonly trace: Trace<string>;
  readonly valid16: boolean;
}

/** Removes surrounding whitespace and trailing punctuation (`. , ; :`). Never alters digits. */
export function normalizeNik(raw: string): NikNormalization {
  const value = raw.trim().replace(/[\s.,;:]+$/, '');
  const t: Trace<string> =
    value === raw
      ? trace(raw, value, 'UNCHANGED', { code: 'NIK_AS_GIVEN', provenance: ENG })
      : trace(raw, value, 'NORMALIZED', { code: 'NIK_TRAILING_PUNCTUATION', provenance: ENG });
  return { trace: t, valid16: /^\d{16}$/.test(value) };
}

export interface NikDecoded {
  readonly gender: Gender;
  readonly yy: number;
  readonly month: number;
  readonly day: number;
}

/** Indonesian NIK digits 7–12 encode DDMMYY; women have DD + 40. */
export function decodeNik(nik16: string): NikDecoded {
  const dd = Number(nik16.slice(6, 8));
  return {
    gender: dd > 40 ? 'FEMALE' : 'MALE',
    day: dd > 40 ? dd - 40 : dd,
    month: Number(nik16.slice(8, 10)),
    yy: Number(nik16.slice(10, 12)),
  };
}
