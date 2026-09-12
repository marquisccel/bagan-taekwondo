import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  normalizeBelt,
  normalizeContingent,
  normalizeDate,
  normalizeDivision,
  normalizeGender,
  normalizeHeightMm,
  normalizeName,
  normalizeNik,
  normalizeWeightG,
  parseWeightClass,
} from './normalize.js';
import { runIntake } from './pipeline.js';
import type { Trace } from './types.js';

const rs = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;

const normalizers: Record<string, (raw: string) => Trace<unknown>> = {
  name: normalizeName,
  contingent: normalizeContingent,
  date: normalizeDate,
  height: normalizeHeightMm,
  weight: normalizeWeightG,
  nik: (raw) => normalizeNik(raw).trace,
  gender: (raw) => normalizeGender(raw, rs),
  belt: (raw) => normalizeBelt(raw, rs),
  division: (raw) => normalizeDivision(raw, rs),
};

describe('normalizer properties (no silent data loss)', () => {
  for (const [name, normalize] of Object.entries(normalizers)) {
    it(`${name}: raw preserved byte-for-byte, rule and provenance always present, value null iff INVALID`, () => {
      fc.assert(
        fc.property(fc.string(), (raw) => {
          const t = normalize(raw);
          expect(t.raw).toBe(raw);
          expect(t.rule.code.length).toBeGreaterThan(0);
          expect(['COMMITTEE', 'STAKEHOLDER', 'EVIDENCE_2026', 'ENGINEERING_DEFAULT', 'TBD']).toContain(
            t.rule.provenance,
          );
          expect(t.value === null).toBe(t.outcome === 'INVALID');
        }),
      );
    });
  }

  it('normalizing a normalized name, contingent, date or NIK is the identity', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        for (const n of [
          normalizeName,
          normalizeContingent,
          normalizeDate,
          (r: string) => normalizeNik(r).trace,
        ]) {
          const once = n(raw);
          if (once.value !== null && typeof once.value === 'string') {
            const twice = n(once.value);
            expect(twice.value).toBe(once.value);
            expect(twice.outcome).toBe('UNCHANGED');
          }
        }
      }),
    );
  });

  it('weight-class parsing is idempotent on its canonical output', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc
            .integer({ min: 0, max: 200 })
            .chain((n) => fc.constantFrom(`-${n}`, `+${n}`, `=+${n}`, `=-${n}`, `${n}+`, `${n}`)),
        ),
        (raw) => {
          const p = parseWeightClass(raw);
          if (p.kind === 'CANONICAL')
            expect(parseWeightClass(p.code)).toEqual({ kind: 'CANONICAL', code: p.code, changed: false });
        },
      ),
    );
  });

  it('decimal parsing is exact: integer mm/g equals the decimal value within half a unit', () => {
    fc.assert(
      fc.property(fc.nat(3000), fc.nat(99), (whole, frac) => {
        const raw = `${whole}.${String(frac).padStart(2, '0')}`;
        const mm = normalizeHeightMm(raw).value;
        const exact = whole * 100 + frac; // in 1/100 cm = 0.1 mm
        if (exact === 0) expect(mm).toBeNull();
        else expect(Math.abs((mm ?? 0) * 10 - exact)).toBeLessThanOrEqual(5);
      }),
    );
  });
});

describe('pipeline determinism (E9)', () => {
  const header =
    'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen';
  const rowArb = fc.record({
    tb: fc.constantFrom('150.00', '0.00', '734.00', '45.00', '150,5', 'abc'),
    bb: fc.constantFrom('44.00', '0.00', '160.00', '420.00'),
    cls: fc.constantFrom('-45', '=+65', '53', '65+', 'INDIVIDUAL'),
    klas: fc.constantFrom('KYORUGI SEMI PRESTASI', 'POOMSAE SEMI PRESTASI', 'KYORUGI PRESTASI', 'X'),
    g: fc.constantFrom('Laki-laki', 'Perempuan', 'L'),
    nik: fc.constantFrom('9901011005130001', '9901011005130001.', '12345'),
  });

  it('any row permutation of any input yields the same snapshot fingerprint and the same issues', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 12 }), fc.nat(), (rows, rot) => {
        const lines = rows.map(
          (r, i) =>
            `ID${i},K,${r.nik},N${i},${r.g},2013-05-10,"${r.tb}",${r.bb},GEUP 9 - KUNING,${r.klas},CADET,${r.cls},K`,
        );
        const rotated = [...lines.slice(rot % lines.length), ...lines.slice(0, rot % lines.length)];
        const a = runIntake({
          sourceName: 'p',
          bytes: new TextEncoder().encode([header, ...lines].join('\n')),
          ruleSet: rs,
        });
        const b = runIntake({
          sourceName: 'p',
          bytes: new TextEncoder().encode([header, ...rotated].join('\n')),
          ruleSet: rs,
        });
        const issues = (r: typeof a) =>
          r.issues.map((i) => `${i.subject.ref}:${i.code}:${i.severity}`).sort();
        expect(issues(b)).toEqual(issues(a));
        expect(b.snapshot?.entries).toEqual(a.snapshot?.entries);
      }),
      { numRuns: 60 },
    );
  });
});
