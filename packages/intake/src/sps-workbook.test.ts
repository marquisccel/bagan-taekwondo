import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import {
  extractParticipantCsv,
  extractTournamentTitle,
  parseJadwalFixSheet,
  resolveSpsSheetNames,
} from './sps-workbook.js';

/**
 * Structural reference: the committee's real "Jadwal FIX" tab (SPS spreadsheet) --
 * - the very first block omits the "DAY N" line (day defaults to 1 until the first explicit one);
 * - every later block restates "DAY N", then the date line, then "ARENA X";
 * - a blank row inside one arena/day is just a visual separator between sub-groups, never a new block.
 */
const rs = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;

describe('parseJadwalFixSheet', () => {
  it('parses the first (DAY-less) block as day 1, and a later explicit DAY N block correctly', () => {
    const matrix = [
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['ARENA A', null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45'],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-48'],
      [null, null, null, null],
      ['DAY 2', null, null, null],
      ['SABTU, 19 SEPTEMBER 2026', null, null, null],
      ['ARENA B', null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Perempuan', 'CADET', '-41'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        sheetRow: 3,
        dayNumber: 1,
        date: '2026-09-18',
        arenaCode: 'A',
        orderIndex: 0,
        stream: 'SEMI_PRESTASI',
        discipline: 'KYORUGI',
        gender: 'MALE',
        ageDivisionCode: 'JUNIOR',
        weightClassOrFormat: '-45',
      },
      {
        sheetRow: 4,
        dayNumber: 1,
        date: '2026-09-18',
        arenaCode: 'A',
        orderIndex: 1,
        stream: 'SEMI_PRESTASI',
        discipline: 'KYORUGI',
        gender: 'MALE',
        ageDivisionCode: 'JUNIOR',
        weightClassOrFormat: '-48',
      },
      {
        sheetRow: 9,
        dayNumber: 2,
        date: '2026-09-19',
        arenaCode: 'B',
        orderIndex: 0,
        stream: 'SEMI_PRESTASI',
        discipline: 'KYORUGI',
        gender: 'FEMALE',
        ageDivisionCode: 'CADET',
        weightClassOrFormat: '-41',
      },
    ]);
  });

  it('treats a blank row inside one arena/day as a group separator, not a new block (order keeps counting)', () => {
    const matrix = [
      ['ARENA A', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45'],
      [null, null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'SENIOR', '-54'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.orderIndex)).toEqual([0, 1]);
    expect(rows.map((r) => r.ageDivisionCode)).toEqual(['JUNIOR', 'SENIOR']);
  });

  it('recognizes a Poomsae row (format in the 4th column, not a weight class) and "Combined" as MIXED', () => {
    const matrix = [
      ['ARENA C', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['POOMSAE SEMI PRESTASI', 'Combined', 'CADET', 'PAIR'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      discipline: 'POOMSAE',
      stream: 'SEMI_PRESTASI',
      gender: 'MIXED',
      weightClassOrFormat: 'PAIR',
    });
  });

  it('maps a "PRESTASI <qualifier>" classification by prefix (e.g. "... TNI/POLRI") to plain PRESTASI', () => {
    const matrix = [
      ['ARENA C', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['POOMSAE PRESTASI TNI/POLRI', 'Laki-laki', 'SENIOR', 'INDIVIDUAL'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ discipline: 'POOMSAE', stream: 'PRESTASI' });
  });

  it('reports (never guesses) a classification the rule set does not recognize, and skips only that row', () => {
    const matrix = [
      ['ARENA C', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['FREESTYLE', 'Laki-laki', 'CADET', 'INDIVIDUAL'],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weightClassOrFormat).toBe('-45');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('FREESTYLE');
  });

  it('reports a category row seen before any ARENA/date header, rather than crashing or guessing', () => {
    const matrix = [['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45']];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(rows).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('before an ARENA/date header');
  });

  it('is deterministic: the same matrix always parses to the same result', () => {
    const matrix = [
      ['ARENA A', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45'],
    ];
    expect(parseJadwalFixSheet(matrix, rs)).toEqual(parseJadwalFixSheet(matrix, rs));
  });

  it("skips the sheet's own title banner and a whole-event date-range banner, never misreading the range as one specific day", () => {
    const matrix = [
      ['JADWAL KEJUARAAN TAEKWONDO INDONESIA SUPER FIGHT 4', null, null, null],
      ['JUMAT s/d MINGGU, 2 - 4 OKTOBER 2026', null, null, null],
      [null, null, null, null],
      ['Jumat, 2 Oktober 2026', null, null, null],
      ['DAY 1', null, null, null],
      ['ARENA A', null, null, null],
      ['KYORUGI PRESTASI', 'Laki-laki', 'SENIOR', '-54'],
    ];
    const { rows, issues } = parseJadwalFixSheet(matrix, rs);
    expect(issues).toEqual([]);
    // The date-range banner never overwrote `date` with a misread "4 Oktober 2026" -- the real row's
    // date is the one explicit single-day line that actually precedes it.
    expect(rows).toEqual([
      {
        sheetRow: 7,
        dayNumber: 1,
        date: '2026-10-02',
        arenaCode: 'A',
        orderIndex: 0,
        stream: 'PRESTASI',
        discipline: 'KYORUGI',
        gender: 'MALE',
        ageDivisionCode: 'SENIOR',
        weightClassOrFormat: '-54',
      },
    ]);
  });
});

describe('extractTournamentTitle', () => {
  it('reads the event name from the "JADWAL KEJUARAAN TAEKWONDO <name>" banner', () => {
    const matrix = [
      ['JADWAL KEJUARAAN TAEKWONDO INDONESIA SUPER FIGHT 4', null, null, null],
      ['JUMAT s/d MINGGU, 2 - 4 OKTOBER 2026', null, null, null],
    ];
    expect(extractTournamentTitle(matrix)).toBe('INDONESIA SUPER FIGHT 4');
  });

  it('returns null (never guesses) when the sheet has no such banner, e.g. an older template', () => {
    const matrix = [
      ['ARENA A', null, null, null],
      ['JUMAT, 18 SEPTEMBER 2026', null, null, null],
      ['KYORUGI SEMI PRESTASI', 'Laki-laki', 'JUNIOR', '-45'],
    ];
    expect(extractTournamentTitle(matrix)).toBeNull();
  });
});

describe('resolveSpsSheetNames', () => {
  const REAL_SHEET_NAMES = [
    'CLASS_CATEGORY',
    'query_kolektif',
    'tanda terima',
    'semi-prestasi',
    'prestasi',
    'atlet_kategori',
    'Jadwal FIX',
    'BAGAN SEMI PRESTASI',
    'PRESTASI KYORUGI',
    'DAY 1-ARENA B',
    'SEMI-PRESTASI KYORUGI',
    'SEMI-PRESTASI POOMSAE',
    'INPUT_JUARA',
  ];

  it('finds the exact real-world tab names', () => {
    expect(resolveSpsSheetNames(REAL_SHEET_NAMES)).toEqual({
      jadwalSheet: 'Jadwal FIX',
      participantSheet: 'semi-prestasi',
    });
  });

  it('is tolerant of case, spacing and an inserted qualifier word in the jadwal tab name', () => {
    for (const name of [
      'JADWAL FIX',
      'jadwal-fix',
      'Jadwal   FIX',
      'Jadwal Terbaru FIX',
      'Jadwal_Fix_2026',
    ]) {
      const names = REAL_SHEET_NAMES.map((n) => (n === 'Jadwal FIX' ? name : n));
      expect(resolveSpsSheetNames(names).jadwalSheet).toBe(name);
    }
  });

  it('is tolerant of case, spacing and punctuation in the participant tab name, without matching the unrelated SEMI-PRESTASI KYORUGI/POOMSAE tabs', () => {
    for (const name of ['SEMI-PRESTASI', 'Semi Prestasi', 'semi_prestasi']) {
      const names = REAL_SHEET_NAMES.map((n) => (n === 'semi-prestasi' ? name : n));
      expect(resolveSpsSheetNames(names).participantSheet).toBe(name);
    }
  });

  it('throws a clear, specific error listing every tab when the jadwal sheet is missing entirely', () => {
    const names = REAL_SHEET_NAMES.filter((n) => n !== 'Jadwal FIX');
    expect(() => resolveSpsSheetNames(names)).toThrow(/no jadwal \(schedule\) sheet/i);
  });

  it('throws a clear, specific error (never picks one arbitrarily) when two sheets equally match the jadwal name', () => {
    const names = [...REAL_SHEET_NAMES, 'Jadwal Fix (revisi)'];
    expect(() => resolveSpsSheetNames(names)).toThrow(
      /more than one sheet.*jadwal.*Jadwal FIX.*Jadwal Fix \(revisi\)/is,
    );
  });

  it('never lets the participant match widen to catch SEMI-PRESTASI KYORUGI/POOMSAE', () => {
    const names = REAL_SHEET_NAMES.filter((n) => n !== 'semi-prestasi');
    expect(() => resolveSpsSheetNames(names)).toThrow(/no semi-prestasi.*sheet/i);
  });
});

describe('extractParticipantCsv', () => {
  it("extracts KOLEKTIF_2026_COLUMNS in canonical order regardless of the sheet's own column order", () => {
    const matrix = [
      [
        'namalengkap',
        'id_athlete',
        'jeniskelamin',
        'nik',
        'tanggallahir',
        'tinggibadan',
        'beratbadan',
        'sabuk',
        'klasifikasi',
        'divisi',
        'class',
        'nama_tim',
        'tim_kontingen',
        'asalsekolah',
      ],
      [
        'Moch. Adam',
        '5641',
        'Laki-laki',
        '9978131905120004',
        '2012-05-19',
        '163.00',
        '49.00',
        'GEUP 6',
        'KYORUGI SEMI PRESTASI',
        'CADET',
        '-49',
        'Marinir',
        'Marinir',
        'SD 1',
      ],
    ];
    const csv = extractParticipantCsv(matrix);
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe(
      'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen',
    );
    expect(row).toBe(
      '5641,Marinir,9978131905120004,Moch. Adam,Laki-laki,2012-05-19,163.00,49.00,GEUP 6,KYORUGI SEMI PRESTASI,CADET,-49,Marinir',
    );
  });

  it('skips a blank row (no id_athlete) rather than emitting an empty entry', () => {
    const matrix = [
      [
        ...'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen'.split(
          ',',
        ),
      ],
      [null, null, null, null, null, null, null, null, null, null, null, null, null],
      [
        '5641',
        'Marinir',
        '9978131905120004',
        'Moch. Adam',
        'Laki-laki',
        '2012-05-19',
        '163',
        '49',
        'GEUP 6',
        'KYORUGI SEMI PRESTASI',
        'CADET',
        '-49',
        'Marinir',
      ],
    ];
    const csv = extractParticipantCsv(matrix);
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  it('throws a clear error when a required column is missing, rather than silently producing wrong CSV', () => {
    const matrix = [['id_athlete', 'namalengkap']];
    expect(() => extractParticipantCsv(matrix)).toThrow(/missing required column/);
  });

  it('never throws over a missing "nama_tim" -- some committee templates drop it entirely, so its value is copied from "tim_kontingen" instead of failing the whole upload', () => {
    const matrix = [
      [
        ...'id_athlete,tim_kontingen,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class'.split(
          ',',
        ),
      ],
      [
        '5474',
        'Klub Uji',
        // Synthetic (region 99 -- ADR-0014's PII audit requires every NIK-shaped test value to use
        // this non-existent province code, never a real person's), not a real athlete's NIK.
        '9901242707170001',
        'Contoh Peserta',
        'Laki-laki',
        '2017-07-27',
        '130.00',
        '28.00',
        'GEUP 8 - KUNING STRIP HIJAU',
        'KYORUGI SEMI PRESTASI',
        'PRA CADET C',
        '-30',
      ],
    ];
    const csv = extractParticipantCsv(matrix);
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe(
      'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen',
    );
    // "nama_tim" (2nd field) is not blank -- it's a copy of "tim_kontingen" ("Klub Uji"), so the
    // CONTINGENT_FIELDS_DIFFER cross-check in rows.ts never fires a false warning for this row.
    expect(row).toBe(
      '5474,Klub Uji,9901242707170001,Contoh Peserta,Laki-laki,2017-07-27,130.00,28.00,GEUP 8 - KUNING STRIP HIJAU,KYORUGI SEMI PRESTASI,PRA CADET C,-30,Klub Uji',
    );
  });

  it('quotes a field containing a comma', () => {
    const header =
      'id_athlete,nama_tim,nik,namalengkap,jeniskelamin,tanggallahir,tinggibadan,beratbadan,sabuk,klasifikasi,divisi,class,tim_kontingen'.split(
        ',',
      );
    const matrix = [header, ['1', 'Tim, A', '', 'Name', 'Laki-laki', '', '', '', '', '', '', '', '']];
    const csv = extractParticipantCsv(matrix);
    expect(csv).toContain('"Tim, A"');
  });
});
