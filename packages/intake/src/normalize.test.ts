import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import {
  collapseWhitespace,
  decodeNik,
  normalizeBelt,
  normalizeDate,
  normalizeGender,
  normalizeHeightMm,
  normalizeName,
  normalizeNik,
  normalizeWeightG,
  parseWeightClass,
} from './normalize.js';
import { diffAgainstDetail } from './report.js';
import type { IntakeResult } from './pipeline.js';

const rs = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;

describe('gender', () => {
  it.each([
    ['Laki-laki', 'MALE'],
    ['Perempuan', 'FEMALE'],
    ['  laki-LAKI ', 'MALE'],
    ['PEREMPUAN', 'FEMALE'],
  ])('%j → %s via the rule-set vocabulary', (raw, value) => {
    const t = normalizeGender(raw, rs);
    expect(t).toMatchObject({
      raw,
      value,
      outcome: 'MAPPED',
      rule: { code: 'VOCAB_GENDER', provenance: 'EVIDENCE_2026' },
    });
  });

  it.each(['L', 'P', 'Male', '', 'Laki'])('%j is not guessed', (raw) => {
    expect(normalizeGender(raw, rs)).toMatchObject({ raw, value: null, outcome: 'INVALID' });
  });
});

describe('belt', () => {
  it('maps an exact source label, tolerating whitespace and case', () => {
    expect(normalizeBelt('GEUP 9 - KUNING', rs).value).toBe('GEUP_9');
    expect(normalizeBelt(' geup 9  -  kuning ', rs).value).toBe('GEUP_9');
    expect(normalizeBelt('HITAM - DAN 1', rs).value).toBe('DAN_1');
  });

  it.each(['GEUP 10 - PUTIH', 'GEUP 9', 'kuning', ''])('%j is unknown, not approximated', (raw) => {
    expect(normalizeBelt(raw, rs)).toMatchObject({ value: null, outcome: 'INVALID' });
  });
});

describe('weight-class parsing', () => {
  it.each([
    ['-45', { kind: 'CANONICAL', code: '-45', changed: false }],
    ['+65', { kind: 'CANONICAL', code: '+65', changed: false }],
    ['=+65', { kind: 'CANONICAL', code: '+65', changed: true }],
    ['=-45', { kind: 'CANONICAL', code: '-45', changed: true }],
    ['65+', { kind: 'CANONICAL', code: '+65', changed: true }],
    [`${String.fromCharCode(0x2212)}45`, { kind: 'CANONICAL', code: '-45', changed: true }],
    [' -45 ', { kind: 'CANONICAL', code: '-45', changed: true }],
    ['53', { kind: 'AMBIGUOUS', digits: '53' }],
    ['-45.5', { kind: 'UNKNOWN' }],
    ['+', { kind: 'UNKNOWN' }],
    ['INDIVIDU', { kind: 'UNKNOWN' }],
    ['', { kind: 'UNKNOWN' }],
  ])('%j', (raw, expected) => {
    expect(parseWeightClass(raw)).toEqual(expected);
  });
});

describe('decimal height and weight', () => {
  it.each([
    ['170.00', 1700, 'UNCHANGED'],
    ['170', 1700, 'UNCHANGED'],
    ['150,5', 1505, 'UNCHANGED'],
    ['145.55', 1456, 'NORMALIZED'],
    ['145.54', 1455, 'NORMALIZED'],
    [' 160.00 ', 1600, 'UNCHANGED'],
  ])('height %j → %i mm (%s)', (raw, mm, outcome) => {
    expect(normalizeHeightMm(raw)).toMatchObject({ raw, value: mm, outcome });
  });

  it.each([
    ['58.30', 58_300],
    ['0.125', 125],
    ['58.3004', 58_300],
    ['58.3005', 58_301],
  ])('weight %j → %i g', (raw, g) => {
    expect(normalizeWeightG(raw).value).toBe(g);
  });

  it.each(['0.00', '0', '', '   '])('%j is missing, not zero', (raw) => {
    expect(normalizeHeightMm(raw)).toMatchObject({ value: null, outcome: 'INVALID', missing: true });
  });

  it.each(['abc', '1.2.3', '-5', '1e3', '170cm'])('%j is invalid, not missing', (raw) => {
    expect(normalizeHeightMm(raw)).toMatchObject({ value: null, outcome: 'INVALID', missing: false });
  });
});

describe('NIK', () => {
  it('removes trailing punctuation and surrounding whitespace, never digits', () => {
    expect(normalizeNik('9901012403100001.')).toMatchObject({
      trace: { value: '9901012403100001', outcome: 'NORMALIZED' },
      valid16: true,
    });
    expect(normalizeNik(' 9901012403100001 ;')).toMatchObject({
      trace: { value: '9901012403100001' },
      valid16: true,
    });
    expect(normalizeNik('9901012403100001')).toMatchObject({
      trace: { outcome: 'UNCHANGED' },
      valid16: true,
    });
    expect(normalizeNik('990101240310001')).toMatchObject({ valid16: false });
    expect(normalizeNik('99010124.03100001')).toMatchObject({
      trace: { value: '99010124.03100001' },
      valid16: false,
    });
  });

  it('decodes gender and birth date (women: day + 40)', () => {
    expect(decodeNik('9901015402110003')).toEqual({ gender: 'FEMALE', day: 14, month: 2, yy: 11 });
    expect(decodeNik('9901012109110001')).toEqual({ gender: 'MALE', day: 21, month: 9, yy: 11 });
  });
});

describe('dates', () => {
  it.each(['2012-02-29', '2016-02-29', '2000-02-29', '2013-12-31'])('%j is valid', (raw) => {
    expect(normalizeDate(raw)).toMatchObject({ value: raw, outcome: 'UNCHANGED' });
  });

  it.each([
    '2013-02-29',
    '1900-02-29',
    '2012-02-30',
    '2012-13-01',
    '2012-00-10',
    '12-01-2012',
    '2012/01/10',
    '2012-1-10',
    '',
  ])('%j is invalid', (raw) => {
    expect(normalizeDate(raw)).toMatchObject({ value: null, outcome: 'INVALID' });
  });

  it('surrounding whitespace is a normalization, not a new value', () => {
    expect(normalizeDate(' 2012-05-05 ')).toMatchObject({ value: '2012-05-05', outcome: 'NORMALIZED' });
  });
});

describe('names and whitespace', () => {
  it('collapses whitespace, preserves case and characters', () => {
    expect(normalizeName('  reg   case  lowercase ')).toMatchObject({
      value: 'reg case lowercase',
      outcome: 'NORMALIZED',
    });
    expect(normalizeName("NAUFAL DAFFA'")).toMatchObject({ value: "NAUFAL DAFFA'", outcome: 'UNCHANGED' });
    expect(normalizeName('M.  A ANG')).toMatchObject({ value: 'M. A ANG', outcome: 'NORMALIZED' });
    expect(normalizeName('   ')).toMatchObject({ value: null, outcome: 'INVALID' });
  });

  it('collapseWhitespace handles tabs and newlines', () => {
    expect(collapseWhitespace('\ta \n b ')).toBe('a b');
  });
});

describe('differential comparator self-test', () => {
  it('detects a single changed issue and a changed category', () => {
    const fake = {
      rows: [{ ref: 'R1', issues: [{ code: 'HEIGHT_MISSING', component: null, severity: 'ERROR' }] }],
      entries: [{ ref: 'R1', memberRows: ['R1'], categoryKey: 'K|A', eligibility: 'BLOCKED' }],
    } as unknown as IntakeResult;
    expect(
      diffAgainstDetail(fake, {
        rows: { R1: ['HEIGHT_MISSING:ERROR'] },
        entries: { R1: { members: ['R1'], category: 'K|A', eligibility: 'BLOCKED' } },
      }),
    ).toEqual([]);
    expect(
      diffAgainstDetail(fake, {
        rows: { R1: ['HEIGHT_MISSING:INFO'] },
        entries: { R1: { members: ['R1'], category: 'K|A', eligibility: 'BLOCKED' } },
      }),
    ).toHaveLength(1);
    expect(
      diffAgainstDetail(fake, {
        rows: { R1: ['HEIGHT_MISSING:ERROR'] },
        entries: { R1: { members: ['R1'], category: 'K|B', eligibility: 'BLOCKED' } },
      }),
    ).toHaveLength(1);
    expect(diffAgainstDetail(fake, { rows: {}, entries: {} })).toHaveLength(2);
  });
});
