import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed, Prng, type DrawSeed } from '@bagantkd/shared';

import { toCsv } from './csv.js';

/**
 * Deterministic synthetic registration exports for load and robustness testing (5k, 10k).
 *
 * Distributions are shaped after the 2026 aggregates (SOURCE_ANALYSIS §2) — stream and division
 * mix, belt ranges per stream, one dominant contingent (~27%) — but every row is invented: no
 * real names, NIK or birth dates. Integer arithmetic only, so the output is byte-identical on
 * every platform for the same (rows, seed, options).
 *
 * Output uses the exact 13-column layout and value vocabulary of the 2026 export, including its
 * quirks (`=+NN` over-classes, decimal strings, pair/team members as separate rows).
 */
export const SOURCE_COLUMNS = [
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

export interface SyntheticOptions {
  readonly rows: number;
  readonly seed: DrawSeed;
  /** Share of rows (per mille) given a known dirty-data pattern, to exercise validation. */
  readonly dirtyPermille: number;
  readonly contingents: number;
}

type Row = Record<(typeof SOURCE_COLUMNS)[number], string>;
type Weighted<T> = readonly (readonly [T, number])[];

const KLASIFIKASI: Weighted<string> = [
  ['KYORUGI SEMI PRESTASI', 1863],
  ['KYORUGI PRESTASI', 591],
  ['POOMSAE SEMI PRESTASI', 533],
  ['POOMSAE PRESTASI', 146],
  ['FREESTYLE', 21],
];

const DIVISI: Readonly<Record<string, Weighted<string>>> = {
  'KYORUGI SEMI PRESTASI': [
    ['PRA CADET A', 38],
    ['PRA CADET B', 198],
    ['PRA CADET C', 577],
    ['CADET', 571],
    ['JUNIOR', 416],
    ['SENIOR', 63],
  ],
  'KYORUGI PRESTASI': [
    ['PRA CADET', 67],
    ['CADET', 203],
    ['JUNIOR', 268],
    ['SENIOR', 53],
  ],
  'POOMSAE SEMI PRESTASI': [
    ['PRA CADET A', 9],
    ['PRA CADET B', 47],
    ['PRA CADET C', 133],
    ['CADET', 202],
    ['JUNIOR', 129],
    ['SENIOR', 13],
  ],
  'POOMSAE PRESTASI': [
    ['PRA CADET', 17],
    ['CADET', 46],
    ['JUNIOR', 62],
    ['SENIOR', 21],
  ],
  FREESTYLE: [
    ['PRA CADET', 3],
    ['CADET', 8],
    ['JUNIOR', 8],
    ['SENIOR', 2],
  ],
};

const SEMI_BELTS: Weighted<string> = [
  ['GEUP 9 - KUNING', 638],
  ['GEUP 8 - KUNING STRIP HIJAU', 326],
  ['GEUP 7 - HIJAU', 359],
  ['GEUP 6 - HIJAU STRIP BIRU', 194],
  ['GEUP 5 - BIRU', 178],
  ['GEUP 4 - BIRU STRIP MERAH', 97],
  ['GEUP 3 - MERAH', 71],
];
const PRESTASI_BELTS: Weighted<string> = [
  ['GEUP 7 - HIJAU', 80],
  ['GEUP 6 - HIJAU STRIP BIRU', 45],
  ['GEUP 5 - BIRU', 64],
  ['GEUP 4 - BIRU STRIP MERAH', 71],
  ['GEUP 3 - MERAH', 117],
  ['GEUP 2 - MERAH STRIP 1', 62],
  ['GEUP 1 - MERAH STRIP 2', 85],
  ['HITAM - DAN 1', 60],
  ['HITAM - DAN 2', 4],
  ['HITAM - DAN 3', 3],
];

/** Birth-year band and mean height (mm) per source division label. */
const DIVISION_PROFILE: Readonly<Record<string, { years: readonly [number, number]; heightMm: number }>> = {
  'PRA CADET A': { years: [2020, 2021], heightMm: 1150 },
  'PRA CADET B': { years: [2018, 2019], heightMm: 1250 },
  'PRA CADET C': { years: [2015, 2017], heightMm: 1400 },
  'PRA CADET': { years: [2015, 2017], heightMm: 1400 },
  CADET: { years: [2012, 2014], heightMm: 1520 },
  JUNIOR: { years: [2009, 2011], heightMm: 1620 },
  SENIOR: { years: [2000, 2008], heightMm: 1680 },
};

function pick<T>(rng: Prng, items: Weighted<T>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.nextBelow(total);
  for (const [item, w] of items) {
    if (r < w) return item;
    r -= w;
  }
  throw new Error('unreachable');
}

/** Approximately normal integer: mean ± spread using the sum of four uniforms (Irwin–Hall). */
function around(rng: Prng, mean: number, spread: number): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) sum += rng.nextBelow(2 * spread + 1) - spread;
  return mean + Math.trunc(sum / 2);
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const cm = (mm: number) => `${Math.floor(mm / 10)}.${mm % 10}0`;
const kg = (g: number) => `${Math.floor(g / 1000)}.${pad(Math.floor((g % 1000) / 10), 2)}`;

function contingentNames(count: number): string[] {
  // Several "cities" split into numbered sub-contingents, as in 2026 (F-12).
  const cities = [
    'Kota Alfa',
    'Kabupaten Beta',
    'Kota Gama',
    'Kabupaten Delta',
    'Kota Epsilon',
    'Kabupaten Zeta',
  ];
  return Array.from(
    { length: count },
    (_, i) => `${cities[i % cities.length] ?? 'Kota'} ${Math.floor(i / cities.length) + 1}`,
  );
}

function contingentWeights(names: readonly string[]): Weighted<string> {
  // One dominant contingent (~27%), one large (~10.5%), long tail ~ 1/rank — matching 2026 (F-12).
  return names.map(
    (n, i) => [n, i === 0 ? 2700 : i === 1 ? 1050 : Math.max(1, Math.floor(1750 / (i + 2)))] as const,
  );
}

function weightClassFor(
  ruleSet: RuleSet,
  stream: string,
  divisionCode: string,
  gender: string,
  weightG: number,
): string | null {
  const table = ruleSet.weightClassTables.find(
    (t) => t.stream === stream && t.ageDivisionCode === divisionCode && t.gender === gender,
  );
  if (!table) return null;
  for (const c of table.classes) {
    const aboveLower = c.lowerExclusiveG === null || weightG > c.lowerExclusiveG;
    const belowUpper = c.upperInclusiveG === null || weightG <= c.upperInclusiveG;
    if (aboveLower && belowUpper) return c.code.startsWith('+') ? `=${c.code}` : c.code;
  }
  const last = table.classes[table.classes.length - 1];
  const first = table.classes[0];
  if (!last || !first) return null;
  const heaviest = last.upperInclusiveG === null ? `=${last.code}` : last.code;
  return first.upperInclusiveG !== null && weightG <= first.upperInclusiveG ? first.code : heaviest;
}

export function generateSyntheticRows(ruleSet: RuleSet, options: SyntheticOptions): Row[] {
  const rng = Prng.fromSeed(options.seed, `synthetic/${options.rows}`);
  const contingents = contingentNames(options.contingents);
  const cWeights = contingentWeights(contingents);
  const vocab = ruleSet.sourceVocabulary;
  const rows: Row[] = [];
  let nextId = 100_000;

  const person = (
    klasifikasi: string,
    divisi: string,
    gender: 'Laki-laki' | 'Perempuan',
    contingent: string,
    format: string,
  ): Row => {
    const profile = DIVISION_PROFILE[divisi];
    const stream = vocab.klasifikasi[klasifikasi]?.stream ?? 'PRESTASI';
    const divisionCode = vocab.divisi[divisi] ?? divisi;
    if (!profile) throw new Error(`no profile for ${divisi}`);
    const year = profile.years[0] + rng.nextBelow(profile.years[1] - profile.years[0] + 1);
    const month = 1 + rng.nextBelow(12);
    const day = 1 + rng.nextBelow(28);
    const heightMm = around(rng, profile.heightMm + (gender === 'Laki-laki' ? 20 : 0), 90);
    const bmiTenths = around(rng, 180, 30);
    const weightG = Math.floor((heightMm * heightMm * bmiTenths) / 10_000);
    const belts = stream === 'SEMI_PRESTASI' ? SEMI_BELTS : PRESTASI_BELTS;
    const id = nextId;
    nextId += 1;
    const nikDay = gender === 'Perempuan' ? day + 40 : day;
    let cls = format;
    if (klasifikasi.startsWith('KYORUGI')) {
      cls =
        weightClassFor(ruleSet, stream, divisionCode, gender === 'Laki-laki' ? 'MALE' : 'FEMALE', weightG) ??
        '-99';
    }
    return {
      id_athlete: String(id),
      nama_tim: contingent,
      nik: `3500${pad(rng.nextBelow(100), 2)}${pad(nikDay, 2)}${pad(month, 2)}${pad(year % 100, 2)}${pad(rng.nextBelow(10_000), 4)}`,
      namalengkap: `SINTETIS ${pad(id, 6)}`,
      jeniskelamin: gender,
      tanggallahir: `${year}-${pad(month, 2)}-${pad(day, 2)}`,
      tinggibadan: cm(heightMm),
      beratbadan: kg(weightG),
      sabuk: pick(rng, belts),
      klasifikasi,
      divisi,
      class: cls,
      tim_kontingen: contingent,
    };
  };

  while (rows.length < options.rows) {
    const klasifikasi = pick(rng, KLASIFIKASI);
    const divisi = pick(rng, DIVISI[klasifikasi] ?? []);
    const contingent = pick(rng, cWeights);
    const isPoomsaePrestasi = klasifikasi === 'POOMSAE PRESTASI' || klasifikasi === 'FREESTYLE';
    const format = isPoomsaePrestasi
      ? pick(rng, [
          ['INDIVIDUAL', 70],
          ['PAIR', 15],
          ['TEAM', klasifikasi === 'FREESTYLE' ? 0 : 15],
        ] as const)
      : 'INDIVIDUAL';
    const gender = rng.nextBelow(100) < 57 ? 'Laki-laki' : 'Perempuan';
    if (format === 'PAIR' && rows.length + 2 <= options.rows) {
      rows.push(
        person(klasifikasi, divisi, 'Laki-laki', contingent, format),
        person(klasifikasi, divisi, 'Perempuan', contingent, format),
      );
    } else if (format === 'TEAM' && rows.length + 3 <= options.rows) {
      rows.push(...[0, 1, 2].map(() => person(klasifikasi, divisi, gender, contingent, format)));
    } else {
      rows.push(person(klasifikasi, divisi, gender, contingent, 'INDIVIDUAL'));
    }
  }

  return injectDirtyData(rows, rng, options.dirtyPermille);
}

/** Known 2026 dirty-data patterns (F-14…F-21), applied to a deterministic subset of rows. */
function injectDirtyData(rows: Row[], rng: Prng, permille: number): Row[] {
  const patterns: ((r: Row) => Row)[] = [
    (r) => ({ ...r, tinggibadan: '0.00', beratbadan: '0.00' }),
    (r) => ({ ...r, tinggibadan: r.beratbadan, beratbadan: r.tinggibadan }),
    (r) => ({ ...r, tinggibadan: `7${r.tinggibadan.slice(1)}` }),
    (r) => ({ ...r, nik: `${r.nik}.` }),
  ];
  return rows.map((r) =>
    rng.nextBelow(1000) < permille ? (patterns[rng.nextBelow(patterns.length)] ?? ((x: Row) => x))(r) : r,
  );
}

export function generateSyntheticCsv(ruleSet: RuleSet, options: SyntheticOptions): string {
  return toCsv(SOURCE_COLUMNS, generateSyntheticRows(ruleSet, options), {
    neutralizeFormulas: false,
  }).replace(/\n$/, '');
}

export const defaultSyntheticOptions = (rows: number, seed: string): SyntheticOptions => ({
  rows,
  seed: parseDrawSeed(seed),
  dirtyPermille: 8,
  contingents: 89,
});
