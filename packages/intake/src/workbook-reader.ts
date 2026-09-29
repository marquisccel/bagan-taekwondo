import * as XLSX from 'xlsx';

/**
 * The only file in this package that touches the actual `.xlsx` binary format (SheetJS) -- kept
 * separate from `sps-workbook.ts`'s parsing logic so that logic stays unit-testable with plain
 * arrays, never a real workbook. A date-formatted cell becomes a plain `YYYY-MM-DD` string (never
 * a `Date` object), read from the cell's own UTC calendar components so no timezone ever shifts
 * the day; every other cell is a plain string or number, `null` when empty.
 */

export type WorkbookCell = string | number | null;
export type WorkbookMatrix = readonly (readonly WorkbookCell[])[];

function toCell(v: unknown): WorkbookCell {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  // A rich-text/formula object SheetJS didn't resolve to a plain value -- never guess its meaning.
  return null;
}

export function listWorkbookSheetNames(bytes: Uint8Array): readonly string[] {
  const wb = XLSX.read(bytes, { type: 'array', bookSheets: true });
  return wb.SheetNames;
}

/** Reads one sheet as a plain cell matrix, one array per row, in the sheet's own row/column order. */
export function readWorkbookSheet(bytes: Uint8Array, sheetName: string): WorkbookMatrix {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true, sheets: [sheetName] });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`sheet not found: ${sheetName}`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  return aoa.map((row) => row.map(toCell));
}
