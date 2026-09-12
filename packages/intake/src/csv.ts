import { DomainError } from '@bagantkd/shared';

/**
 * RFC 4180 CSV parser. Handles quoted fields, escaped quotes, commas and newlines inside
 * quotes, CRLF/LF line endings, a UTF-8 BOM, and a missing final newline (the 2026 export
 * has none, which made `wc -l` undercount by one — SOURCE_ANALYSIS F-01).
 */
export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

export function parseCsv(text: string): CsvTable {
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
  const records = parseRecords(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
  const header = records[0];
  if (!header || header.length === 0) throw new DomainError('CSV_EMPTY');
  if (new Set(header).size !== header.length)
    throw new DomainError('CSV_DUPLICATE_HEADER', { header: header.join(',') });
  const rows = records.slice(1).map((fields, i) => {
    if (fields.length !== header.length) {
      throw new DomainError('CSV_FIELD_COUNT_MISMATCH', {
        row: i + 2,
        expected: header.length,
        actual: fields.length,
      });
    }
    return Object.fromEntries(header.map((h, j) => [h, fields[j] ?? '']));
  });
  return { header, rows };
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (i < text.length) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      if (field.length > 0) throw new DomainError('CSV_UNEXPECTED_QUOTE', { offset: i });
      quoted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\r' && text[i + 1] === '\n') {
      endRecord();
      i += 1;
    } else if (c === '\n') {
      endRecord();
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) throw new DomainError('CSV_UNTERMINATED_QUOTE');
  if (field.length > 0 || record.length > 0) endRecord();
  return records;
}

/**
 * Serializes with RFC 4180 quoting. By default neutralizes spreadsheet formula prefixes
 * (=, +, -, @) so exported values cannot execute or be re-evaluated (SOURCE_ANALYSIS F-37).
 * `neutralizeFormulas: false` is only for generating raw test input that mimics a source export.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly Readonly<Record<string, string>>[],
  options: { readonly neutralizeFormulas: boolean } = { neutralizeFormulas: true },
): string {
  const cell = (v: string) => {
    const safe =
      options.neutralizeFormulas && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `${[header.map(cell).join(','), ...rows.map((r) => header.map((h) => cell(r[h] ?? '')).join(','))].join('\n')}\n`;
}
