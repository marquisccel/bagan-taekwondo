import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { makeFixtureModel } from './testing/fixtures.js';
import { buildExportWorkbook } from './xlsx.js';

const opts = { mode: 'OFFICIAL' as const, generatedAt: '2026-08-27T10:00:00Z', verificationCode: 'abc123' };

/**
 * exceljs's bundled .d.ts declares `load(buffer: Buffer, …)`, and under this repo's root
 * typecheck (tsconfig.lint.json) that `Buffer` resolves to a different generic instantiation than
 * the one `Buffer.from()` itself produces here — a duplicate-@types/node identity mismatch, not a
 * real runtime incompatibility (exceljs happily accepts any real Buffer). Casting the function
 * itself sidesteps the structural comparison instead of fighting it at every call site.
 */
const loadWorkbook = (wb: ExcelJS.Workbook, bytes: Uint8Array): Promise<unknown> =>
  (wb.xlsx.load as unknown as (b: Uint8Array) => Promise<unknown>)(bytes);

describe('buildExportWorkbook', () => {
  it('produces the 8 required Indonesian-labeled sheets, reopenable by the same library', async () => {
    const model = makeFixtureModel({ participantCount: 8 });
    const bytes = await buildExportWorkbook(model, opts);

    const wb = new ExcelJS.Workbook();
    await loadWorkbook(wb, bytes);
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Ringkasan',
      'Kategori',
      'Peserta',
      'Pool',
      'Bagan',
      'Pertandingan',
      'Kualitas',
      'Metadata Audit',
    ]);
  });

  it('Peserta sheet has one row per participant, in the same order as the canonical model (deterministic)', async () => {
    const model = makeFixtureModel({ participantCount: 8 });
    const bytes = await buildExportWorkbook(model, opts);
    const wb = new ExcelJS.Workbook();
    await loadWorkbook(wb, bytes);
    const sheet = wb.getWorksheet('Peserta');
    expect(sheet).toBeDefined();
    const nameCol = (sheet?.getRow(1).values as unknown[]).indexOf('Peserta');
    const rows = sheet?.getRows(2, sheet.rowCount - 1) ?? [];
    expect(rows).toHaveLength(8);
    const names = rows.map((r) => r.getCell(nameCol).value);
    expect(names).toEqual(model.categories[0]?.pools[0]?.members.map((m) => m.displayName));
  });

  it('has stable headers and correct numeric typing (weight is a number, not a string)', async () => {
    const model = makeFixtureModel({ participantCount: 2 });
    const bytes = await buildExportWorkbook(model, opts);
    const wb = new ExcelJS.Workbook();
    await loadWorkbook(wb, bytes);
    const sheet = wb.getWorksheet('Peserta');
    const headerRow = sheet?.getRow(1).values as unknown[];
    expect(headerRow.slice(1)).toEqual([
      'Kategori',
      'Pool',
      'Peserta',
      'Kontingen',
      'Berat (kg)',
      'Tinggi (mm)',
      'Sabuk',
    ]);
    const weightCol = (sheet?.getRow(1).values as unknown[]).indexOf('Berat (kg)');
    const weightCell = sheet?.getRow(2).getCell(weightCol).value;
    expect(typeof weightCell).toBe('number');
  });

  it('produces byte-identical output for the same model and options (deterministic, no random IDs)', async () => {
    const model = makeFixtureModel({ participantCount: 8 });
    const a = await buildExportWorkbook(model, opts);
    const b = await buildExportWorkbook(model, opts);
    // exceljs does not embed a random id, but `created` is taken from opts.generatedAt (fixed here),
    // so two builds from the same inputs should match byte-for-byte.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('never includes a NIK-shaped 16-digit number or a NIK column name anywhere in the workbook', async () => {
    const model = makeFixtureModel({ participantCount: 16 });
    const bytes = await buildExportWorkbook(model, opts);
    const wb = new ExcelJS.Workbook();
    await loadWorkbook(wb, bytes);
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const raw = cell.value;
          const value = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw ?? '');
          expect(value).not.toMatch(/\b\d{16}\b/);
          expect(value.toLowerCase()).not.toContain('nik');
        });
      });
    }
  });

  it('Bagan sheet marks empty slots as BYE, never a fabricated participant name', async () => {
    const model = makeFixtureModel({ participantCount: 5 });
    const bytes = await buildExportWorkbook(model, opts);
    const wb = new ExcelJS.Workbook();
    await loadWorkbook(wb, bytes);
    const sheet = wb.getWorksheet('Bagan');
    const entryCol = (sheet?.getRow(1).values as unknown[]).indexOf('Peserta');
    const entries = (sheet?.getRows(2, sheet.rowCount - 1) ?? []).map((r) => r.getCell(entryCol).value);
    expect(entries.filter((v) => v === 'BYE')).toHaveLength(3);
  });
});
