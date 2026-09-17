import ExcelJS from 'exceljs';

import type { ExportEntry, ExportModel } from './model.js';
import type { RenderOptions } from './pdf/layout.js';

const joinAthleteField = (
  e: ExportEntry,
  pick: (a: ExportEntry['athletes'][number]) => string | number | null,
): string =>
  e.athletes
    .map((a) => pick(a))
    .filter((v): v is string | number => v !== null)
    .join(' / ');

/** A single-athlete entry (the common case) keeps its native number/string type; a team entry falls back to a joined string. */
const athleteField = (
  e: ExportEntry,
  pick: (a: ExportEntry['athletes'][number]) => string | number | null,
): string | number => {
  const only = e.athletes.length === 1 ? e.athletes[0] : undefined;
  if (only) return pick(only) ?? '';
  return joinAthleteField(e, pick);
};

const feederText = (
  f: { kind: 'slot'; slot: number } | { kind: 'match'; publicCode: string | null },
): string => (f.kind === 'slot' ? `Slot ${f.slot + 1}` : `Pemenang ${f.publicCode ?? '?'}`);

/**
 * A human-usable workbook, not a database dump (ACCEPTANCE §9): eight fixed Indonesian-labeled
 * sheets built entirely from the canonical ExportModel, in the model's own deterministic order. No
 * NIK anywhere, no formulas (nothing here needs one), stable headers.
 */
export async function buildExportWorkbook(model: ExportModel, opts: RenderOptions): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'bagan-tkd';
  wb.created = new Date(opts.generatedAt);

  const ringkasan = wb.addWorksheet('Ringkasan');
  ringkasan.columns = [
    { header: 'Field', key: 'k', width: 28 },
    { header: 'Nilai', key: 'v', width: 50 },
  ];
  ringkasan.addRows([
    { k: 'Turnamen', v: model.tournament.name },
    { k: 'Kode turnamen', v: model.tournament.code },
    { k: 'Revisi', v: model.revision.revisionNo },
    { k: 'Status revisi', v: model.revision.lifecycle },
    { k: 'Status dokumen', v: opts.mode === 'PREVIEW' ? 'PREVIEW — BUKAN UNTUK PENGGUNAAN RESMI' : 'RESMI' },
    { k: 'Dibuat', v: opts.generatedAt },
    { k: 'Kode verifikasi', v: opts.verificationCode },
    { k: 'Jumlah kategori', v: model.categories.length },
    { k: 'Jumlah peserta', v: model.categories.reduce((s, c) => s + c.participantCount, 0) },
  ]);

  const kategori = wb.addWorksheet('Kategori');
  kategori.columns = [
    { header: 'Kategori', key: 'categoryKey', width: 40 },
    { header: 'Cabang', key: 'discipline', width: 12 },
    { header: 'Format', key: 'format', width: 14 },
    { header: 'Gender', key: 'gender', width: 10 },
    { header: 'Movement', key: 'movement', width: 14 },
    { header: 'Kelas Usia', key: 'ageDivisionCode', width: 14 },
    { header: 'Kelas Berat', key: 'weightClassCode', width: 14 },
    { header: 'Status', key: 'readiness', width: 12 },
    { header: 'Peserta', key: 'participantCount', width: 10 },
    { header: 'Jumlah Pool', key: 'poolCount', width: 10 },
  ];
  for (const c of model.categories) {
    kategori.addRow({ ...c, poolCount: c.pools.length });
  }

  const peserta = wb.addWorksheet('Peserta');
  peserta.columns = [
    { header: 'Kategori', key: 'categoryKey', width: 40 },
    { header: 'Pool', key: 'poolUid', width: 12 },
    { header: 'Peserta', key: 'displayName', width: 30 },
    { header: 'Kontingen', key: 'contingent', width: 24 },
    { header: 'Berat (kg)', key: 'weight', width: 12 },
    { header: 'Tinggi (mm)', key: 'height', width: 12 },
    { header: 'Sabuk', key: 'belt', width: 12 },
  ];
  for (const c of model.categories) {
    for (const p of c.pools) {
      for (const e of p.members) {
        peserta.addRow({
          categoryKey: c.categoryKey,
          poolUid: p.poolUid,
          displayName: e.displayName,
          contingent: e.contingent,
          weight: athleteField(e, (a) => (a.weightG !== null ? a.weightG / 1000 : null)),
          height: athleteField(e, (a) => a.heightMm),
          belt: athleteField(e, (a) => a.beltCode),
        });
      }
    }
  }

  const pool = wb.addWorksheet('Pool');
  pool.columns = [
    { header: 'Kategori', key: 'categoryKey', width: 40 },
    { header: 'Pool', key: 'poolUid', width: 12 },
    { header: 'Urutan', key: 'ordinal', width: 8 },
    { header: 'Walkover', key: 'isWalkover', width: 10 },
    { header: 'Jumlah Peserta', key: 'memberCount', width: 12 },
    { header: 'Ukuran Bagan', key: 'bracketSize', width: 12 },
    { header: 'Babak', key: 'rounds', width: 8 },
    { header: 'BYE', key: 'byes', width: 8 },
    { header: 'Peringatan', key: 'warnings', width: 40 },
  ];
  for (const c of model.categories) {
    for (const p of c.pools) {
      pool.addRow({
        categoryKey: c.categoryKey,
        poolUid: p.poolUid,
        ordinal: p.ordinal,
        isWalkover: p.isWalkover ? 'Ya' : 'Tidak',
        memberCount: p.members.length,
        bracketSize: p.bracket?.size ?? '',
        rounds: p.bracket?.rounds ?? '',
        byes: p.bracket?.byes ?? '',
        warnings: p.warnings.join('; '),
      });
    }
  }

  const bagan = wb.addWorksheet('Bagan');
  bagan.columns = [
    { header: 'Kategori', key: 'categoryKey', width: 40 },
    { header: 'Pool', key: 'poolUid', width: 12 },
    { header: 'Slot', key: 'position', width: 8 },
    { header: 'Unggulan', key: 'seedNo', width: 10 },
    { header: 'Peserta', key: 'entry', width: 30 },
    { header: 'Kontingen', key: 'contingent', width: 24 },
  ];
  for (const c of model.categories) {
    for (const p of c.pools) {
      for (const s of p.bracket?.slots ?? []) {
        bagan.addRow({
          categoryKey: c.categoryKey,
          poolUid: p.poolUid,
          position: s.position + 1,
          seedNo: s.seedNo ?? '',
          entry: s.isBye ? 'BYE' : (s.entry?.displayName ?? ''),
          contingent: s.isBye ? '' : (s.entry?.contingent ?? ''),
        });
      }
    }
  }

  const pertandingan = wb.addWorksheet('Pertandingan');
  pertandingan.columns = [
    { header: 'Kategori', key: 'categoryKey', width: 40 },
    { header: 'Pool', key: 'poolUid', width: 12 },
    { header: 'Kode', key: 'code', width: 14 },
    { header: 'Babak', key: 'round', width: 8 },
    { header: 'Sisi A', key: 'feederA', width: 18 },
    { header: 'Sisi B', key: 'feederB', width: 18 },
    { header: 'Status', key: 'status', width: 12 },
  ];
  for (const c of model.categories) {
    for (const p of c.pools) {
      for (const m of p.bracket?.matches ?? []) {
        pertandingan.addRow({
          categoryKey: c.categoryKey,
          poolUid: p.poolUid,
          code: m.publicCode ?? m.matchUid,
          round: m.round,
          feederA: feederText(m.feederA),
          feederB: feederText(m.feederB),
          status: m.status,
        });
      }
    }
  }

  const kualitas = wb.addWorksheet('Kualitas');
  kualitas.columns = [
    { header: 'Level', key: 'level', width: 10 },
    { header: 'Kode', key: 'code', width: 30 },
    { header: 'Pesan', key: 'message', width: 60 },
  ];
  for (const f of model.quality.findings) {
    kualitas.addRow(f);
  }

  const metadata = wb.addWorksheet('Metadata Audit');
  metadata.columns = [
    { header: 'Field', key: 'k', width: 28 },
    { header: 'Nilai', key: 'v', width: 60 },
  ];
  metadata.addRows([
    { k: 'Tournament ID', v: model.tournament.id },
    { k: 'Revision ID', v: model.revision.id },
    { k: 'Content fingerprint', v: model.revision.contentFingerprint ?? '' },
    { k: 'Submitted at', v: model.revision.submittedAt ?? '' },
    { k: 'Approved at', v: model.revision.approvedAt ?? '' },
    { k: 'Locked at', v: model.revision.lockedAt ?? '' },
    { k: 'Published at', v: model.revision.publishedAt ?? '' },
    { k: 'Verification code', v: opts.verificationCode },
    { k: 'Generated at', v: opts.generatedAt },
    { k: 'Mode', v: opts.mode },
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
