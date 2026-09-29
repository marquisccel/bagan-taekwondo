import type { CategoryGender, Discipline, Stream } from '@bagantkd/domain';
import type { RuleSet } from '@bagantkd/rules';

import { KOLEKTIF_2026_COLUMNS } from './rows.js';
import { normalizeDivision, vocabularyKey } from './normalize.js';

/**
 * Reads the committee's own SPS spreadsheet ("Jadwal FIX" schedule tab and the "semi-prestasi"
 * participant tab) into the shapes the rest of the system already understands: the participant
 * tab becomes a CSV matching `KOLEKTIF_2026_COLUMNS` (fed straight into the existing, already-
 * tested `runIntake` pipeline, unchanged); the schedule tab becomes plain arena/day facts (never
 * a `category` row -- those are only created lazily by a draw run, draw-run-repository.ts).
 *
 * Pure functions over a plain cell matrix (`readonly (string | number | null)[][]`, one row per
 * array, 1:1 with the sheet's own rows/columns) -- the actual `.xlsx` reading (SheetJS) is a thin
 * adapter kept out of this file so these functions are unit-testable with plain arrays, no real
 * workbook needed.
 */

export interface ScheduleRow {
  readonly sheetRow: number;
  readonly dayNumber: number;
  /** ISO `YYYY-MM-DD`, parsed from the sheet's own Indonesian date line; the weekday is never
   * stored (see docs on the `schedule_entry` table) -- always recomputed from this date. */
  readonly date: string;
  /** Single-letter/short arena code, e.g. "A" from "ARENA A". */
  readonly arenaCode: string;
  /** 0-based order within this (dayNumber, arenaCode), exactly as the sheet listed it. */
  readonly orderIndex: number;
  readonly stream: Stream;
  readonly discipline: Discipline;
  readonly gender: CategoryGender;
  readonly ageDivisionCode: string;
  /** Raw weight-class code ("-45") for Kyorugi, or entry format ("INDIVIDUAL"/"PAIR"/"TEAM") for
   * Poomsae -- callers branch on `discipline` to know which. Never normalized further here. */
  readonly weightClassOrFormat: string;
}

export interface ScheduleParseIssue {
  readonly sheetRow: number;
  readonly message: string;
}

export interface ScheduleParseResult {
  readonly rows: readonly ScheduleRow[];
  readonly issues: readonly ScheduleParseIssue[];
}

const cell = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).trim();
const isBlankRow = (row: readonly (string | number | null)[]): boolean => row.every((v) => cell(v) === '');

const DAY_HEADER_RE = /^DAY\s+(\d+)$/i;
const ARENA_HEADER_RE = /^ARENA\s+([A-Z0-9]+)$/i;
const MONTHS_ID: Readonly<Record<string, number>> = {
  JANUARI: 1,
  FEBRUARI: 2,
  MARET: 3,
  APRIL: 4,
  MEI: 5,
  JUNI: 6,
  JULI: 7,
  AGUSTUS: 8,
  SEPTEMBER: 9,
  OKTOBER: 10,
  NOVEMBER: 11,
  DESEMBER: 12,
};
/** "JUMAT, 18 SEPTEMBER 2026" -> "2026-09-18" -- the weekday name itself is read and discarded;
 * the calendar date is the only fact ever persisted (see `ScheduleRow.date`). */
function parseIndonesianDateLine(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS_ID[(m[2] ?? '').toUpperCase()];
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const GENDER_WORDS: Readonly<Record<string, CategoryGender>> = {
  'LAKI-LAKI': 'MALE',
  PEREMPUAN: 'FEMALE',
  COMBINED: 'MIXED',
  CAMPURAN: 'MIXED',
  MIXED: 'MIXED',
};

/** "KYORUGI SEMI PRESTASI", "POOMSAE PRESTASI TNI/POLRI", ... -> {discipline, stream}. Matches by
 * prefix so a qualifier the sheet appends after "PRESTASI" (e.g. "TNI/POLRI") never breaks the
 * classification -- an unrecognized leading word is reported as an issue, never guessed. */
function classify(raw: string): { discipline: Discipline; stream: Stream } | null {
  const key = vocabularyKey(raw);
  const discipline: Discipline | null = key.startsWith('KYORUGI')
    ? 'KYORUGI'
    : key.startsWith('FREESTYLE')
      ? 'FREESTYLE_POOMSAE'
      : key.startsWith('POOMSAE')
        ? 'POOMSAE'
        : null;
  if (!discipline) return null;
  const rest = key.slice(discipline.length).trim();
  const stream: Stream | null = rest.startsWith('SEMI PRESTASI')
    ? 'SEMI_PRESTASI'
    : rest.startsWith('PRESTASI')
      ? 'PRESTASI'
      : null;
  if (!stream) return null;
  return { discipline, stream };
}

/**
 * Parses the "Jadwal FIX" tab: blocks of `DAY N` / a date line / `ARENA X` (the very first block
 * in the real sheet omits the `DAY N` line -- day 1 is simply the running default until the first
 * explicit `DAY N` line is seen), followed by category rows (discipline+stream, gender, age
 * division, weight class or format), blank rows used only as a visual separator between groups
 * WITHIN one arena/day (never a block boundary by themselves).
 */
export function parseJadwalFixSheet(
  matrix: readonly (readonly (string | number | null)[])[],
  rs: RuleSet,
): ScheduleParseResult {
  const rows: ScheduleRow[] = [];
  const issues: ScheduleParseIssue[] = [];
  let dayNumber = 1;
  let date: string | null = null;
  let arenaCode: string | null = null;
  let orderIndex = 0;

  for (let i = 0; i < matrix.length; i += 1) {
    const sheetRow = i + 1;
    const row = matrix[i] ?? [];
    if (isBlankRow(row)) continue;
    const a = cell(row[0]);
    const b = cell(row[1]);
    const c = cell(row[2]);
    const d = cell(row[3]);

    if (b === '' && c === '' && d === '') {
      const dayMatch = DAY_HEADER_RE.exec(a);
      if (dayMatch) {
        dayNumber = Number(dayMatch[1]);
        continue;
      }
      const arenaMatch = ARENA_HEADER_RE.exec(a);
      if (arenaMatch) {
        arenaCode = (arenaMatch[1] ?? '').toUpperCase();
        orderIndex = 0;
        continue;
      }
      const parsedDate = parseIndonesianDateLine(a);
      if (parsedDate) {
        date = parsedDate;
        continue;
      }
      if (a === '') continue;
      issues.push({ sheetRow, message: `Unrecognized header line: ${JSON.stringify(a)}` });
      continue;
    }

    if (arenaCode === null || date === null) {
      issues.push({ sheetRow, message: 'Category row appears before an ARENA/date header; skipped.' });
      continue;
    }
    const cls = classify(a);
    if (!cls) {
      issues.push({ sheetRow, message: `Unrecognized discipline/stream: ${JSON.stringify(a)}` });
      continue;
    }
    const gender = GENDER_WORDS[vocabularyKey(b)] ?? null;
    if (!gender) {
      issues.push({ sheetRow, message: `Unrecognized gender: ${JSON.stringify(b)}` });
      continue;
    }
    const division = normalizeDivision(c, rs);
    if (division.value === null) {
      issues.push({ sheetRow, message: `Unrecognized age division: ${JSON.stringify(c)}` });
      continue;
    }
    if (d === '') {
      issues.push({ sheetRow, message: 'Missing weight class / format (4th column).' });
      continue;
    }
    rows.push({
      sheetRow,
      dayNumber,
      date,
      arenaCode,
      orderIndex: orderIndex++,
      stream: cls.stream,
      discipline: cls.discipline,
      gender,
      ageDivisionCode: division.value,
      weightClassOrFormat: d,
    });
  }
  return { rows, issues };
}

/**
 * Extracts the participant roster from a sheet shaped like the "semi-prestasi"/"prestasi" tabs
 * into CSV text matching `KOLEKTIF_2026_COLUMNS` exactly -- the same shape `runIntake` already
 * consumes, so nothing downstream of this function needs to change. Column order in the source
 * sheet doesn't matter: each `KOLEKTIF_2026_COLUMNS` name is looked up by its own header text.
 * Extra columns the sheet carries (e.g. "asalsekolah", "No. HP", "Email") are simply not selected.
 */
export function extractParticipantCsv(matrix: readonly (readonly (string | number | null)[])[]): string {
  const header = (matrix[0] ?? []).map((h) => cell(h));
  const indexOf = new Map(header.map((h, i) => [vocabularyKey(h), i] as const));
  const missing = KOLEKTIF_2026_COLUMNS.filter((c) => !indexOf.has(vocabularyKey(c)));
  if (missing.length > 0) {
    throw new Error(`sheet is missing required column(s): ${missing.join(', ')}`);
  }
  const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [KOLEKTIF_2026_COLUMNS.join(',')];
  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r] ?? [];
    if (isBlankRow(row)) continue;
    const idCell = row[indexOf.get(vocabularyKey('id_athlete')) ?? 0];
    if (cell(idCell) === '') continue;
    lines.push(
      KOLEKTIF_2026_COLUMNS.map((col) => escape(cell(row[indexOf.get(vocabularyKey(col)) ?? -1]))).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
