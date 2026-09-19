/**
 * Indonesian operator-facing labels for persisted backend codes (tournament list, participant
 * inspection, draw generation). Presentation only: the backend stays the source of truth for every
 * code, and a code without an entry falls back to `humanizeCode` (an honest rendering of the code,
 * never an invented explanation). The raw code is always shown next to the text where it matters,
 * so an operator can quote it.
 */

export function humanizeCode(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

const lookup =
  (table: Readonly<Record<string, string>>) =>
  (value: string): string =>
    table[value] ?? humanizeCode(value);

export const tournamentStatusLabel = lookup({
  DRAFT: 'Draf',
  ACTIVE: 'Aktif',
  COMPLETED: 'Selesai',
  ARCHIVED: 'Diarsipkan',
});

export const ruleSetStatusLabel = lookup({
  DRAFT: 'Draf',
  ACTIVE: 'Aktif',
  RETIRED: 'Dinonaktifkan',
  NONE: 'Belum ada',
});

export const drawRunStatusLabel = lookup({
  QUEUED: 'Dalam antrean',
  RUNNING: 'Sedang diproses',
  SAFE: 'Aman',
  UNSAFE: 'Tidak aman',
  FAILED: 'Gagal',
});

export const drawRunKindLabel = lookup({ CANDIDATE: 'Kandidat', SIMULATION: 'Simulasi' });

export const revisionLifecycleLabel = lookup({
  DRAFT: 'Draf',
  REVIEW: 'Tinjauan',
  APPROVED: 'Disetujui',
  LOCKED: 'Terkunci',
  PUBLISHED: 'Diterbitkan',
  AMENDED: 'Diamendemen',
  SUPERSEDED: 'Digantikan',
});

export const disciplineLabel = lookup({
  KYORUGI: 'Kyorugi',
  POOMSAE: 'Poomsae',
  FREESTYLE_POOMSAE: 'Freestyle Poomsae',
});

export const streamLabel = lookup({ PRESTASI: 'Prestasi', SEMI_PRESTASI: 'Semi Prestasi' });

export const formatLabel = lookup({ INDIVIDUAL: 'Individu', PAIR: 'Pasangan', TEAM: 'Beregu' });

export const genderLabel = lookup({ MALE: 'Putra', FEMALE: 'Putri', MIXED: 'Campuran' });

export const registrationStatusLabel = lookup({
  REGISTERED: 'Terdaftar',
  VERIFIED: 'Terverifikasi',
  WITHDRAWN: 'Mengundurkan diri',
  DQ: 'Didiskualifikasi',
  NO_SHOW: 'Tidak hadir',
});

export const eligibilityLabel = lookup({
  READY: 'Siap',
  BLOCKED: 'Diblokir',
  OVERRIDDEN: 'Dikecualikan (override)',
  DRAWN: 'Sudah diundi',
});

export const issueSeverityLabel = lookup({ ERROR: 'Kesalahan', WARNING: 'Peringatan', INFO: 'Info' });

export const issueStatusLabel = lookup({
  OPEN: 'Terbuka',
  ACKNOWLEDGED: 'Diakui',
  OVERRIDDEN: 'Dikecualikan',
  CORRECTED: 'Dikoreksi',
  RESOLVED: 'Selesai',
});

export const groupSourceLabel = lookup({
  EXPLICIT: 'Eksplisit',
  IMPORTED: 'Dari berkas',
  HEURISTIC: 'Dugaan sistem',
  MANUAL: 'Manual',
});

export const groupStatusLabel = lookup({
  PROPOSED: 'Diusulkan',
  CONFIRMED: 'Terkonfirmasi',
  REJECTED: 'Ditolak',
});

export const confidenceLabel = lookup({ HIGH: 'tinggi', MEDIUM: 'sedang', LOW: 'rendah' });

/** Data-quality issue codes and entry blocking reasons persisted by intake (packages/intake). */
export const issueCodeLabel = lookup({
  NAME_MISSING: 'Nama peserta kosong',
  NAME_REQUIRED: 'Nama peserta wajib diisi',
  NIK_MISSING: 'NIK tidak diisi',
  NIK_INVALID_FORMAT: 'Format NIK tidak valid',
  NIK_BIRTHDATE_MISMATCH: 'Tanggal lahir tidak sesuai NIK',
  NIK_GENDER_MISMATCH: 'Jenis kelamin tidak sesuai NIK',
  UNKNOWN_GENDER: 'Jenis kelamin tidak dikenali',
  INVALID_DATE: 'Tanggal tidak valid',
  DOB_POSSIBLE_PLACEHOLDER: 'Tanggal lahir diduga placeholder',
  HEIGHT_MISSING: 'Tinggi badan kosong',
  HEIGHT_OUT_OF_RANGE: 'Tinggi badan di luar batas wajar',
  WEIGHT_MISSING: 'Berat badan kosong',
  WEIGHT_OUT_OF_RANGE: 'Berat badan di luar batas wajar',
  BMI_IMPLAUSIBLE: 'BMI tidak wajar',
  HEIGHT_WEIGHT_LIKELY_SWAPPED: 'Tinggi dan berat diduga tertukar',
  UNKNOWN_BELT: 'Sabuk tidak dikenali',
  UNKNOWN_DIVISION: 'Divisi umur tidak dikenali',
  UNKNOWN_CLASS: 'Kelas tidak dikenali',
  UNKNOWN_CLASSIFICATION: 'Klasifikasi tidak dikenali',
  AMBIGUOUS_WEIGHT_CLASS: 'Kelas berat ambigu',
  WEIGHT_CLASS_MISMATCH: 'Kelas berat tidak sesuai berat badan',
  AGE_DIVISION_CONFLICT: 'Divisi umur bertentangan',
  AGE_DIVISION_PLAY_UP: 'Peserta naik divisi umur',
  NO_CATEGORY_TEMPLATE: 'Tidak ada templat kategori',
  CATEGORY_KEY_INCOMPLETE: 'Kunci kategori belum lengkap',
  MOVEMENT_UNRESOLVED: 'Gerakan poomsae belum ditentukan',
  ATHLETE_ATTRIBUTE_CONFLICT: 'Data atlet bertentangan antar baris',
  ATHLETE_MULTIPLE_CONTINGENTS: 'Atlet terdaftar di lebih dari satu kontingen',
  POSSIBLE_DUPLICATE_PERSON: 'Kemungkinan atlet ganda',
  DUPLICATE_SOURCE_ID: 'ID sumber ganda',
  ENTRY_GROUP_AMBIGUOUS: 'Pengelompokan pasangan/beregu ambigu',
  ENTRY_GROUP_INCOMPLETE: 'Anggota pasangan/beregu belum lengkap',
  ENTRY_GROUP_UNCONFIRMED: 'Pengelompokan belum dikonfirmasi',
  ENTRY_GROUP_UNRESOLVED: 'Pengelompokan belum terselesaikan',
  SAME_CONTINGENT_CATEGORY_COMPOSITION: 'Komposisi kontingen pada kategori perlu diperiksa',
});

/** Reasons the frozen draw engine gives for UNSAFE / FAILED runs (packages/draw-engine/src/codes.ts). */
export const drawReasonLabel = lookup({
  ENGINE_VERSION_MISMATCH: 'Versi mesin drawing tidak cocok.',
  ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE: 'Asumsi tidak diperbolehkan untuk drawing kandidat.',
  RULE_SET_INVALID: 'Set aturan tidak valid.',
  SCOPE_CATEGORY_UNKNOWN: 'Cakupan memuat kategori yang tidak dikenal.',
  ENTRY_MALFORMED: 'Ada data peserta yang tidak valid.',
  INTAKE_DISAGREEMENT: 'Data pendaftaran tidak konsisten dengan data intake.',
  CATEGORY_KEY_MISMATCH: 'Kunci kategori tidak sesuai.',
  CATEGORY_BLOCKED: 'Ada kategori yang diblokir sehingga drawing tidak dapat dipakai.',
  PLACEMENT_INVARIANT_VIOLATED: 'Penempatan peserta melanggar aturan dasar drawing.',
  BRACKET_INVARIANT_VIOLATED: 'Bagan melanggar aturan dasar drawing.',
  RESOURCE_LIMIT_EXCEEDED: 'Batas sumber daya terlampaui.',
  ENGINE_INTERNAL_ERROR: 'Terjadi kesalahan internal pada mesin drawing.',
  WORKER_TIMEOUT: 'Proses drawing terhenti (batas waktu terlampaui).',
});

/** Findings of the existing rule-set LOCK assessment (packages/rules/src/readiness.ts). */
export const ruleFindingLabel = lookup({
  RULE_SET_NOT_ACTIVE: 'Set aturan belum berstatus aktif',
  MAX_TOLERANCE_UNSET: 'Batas maksimum toleransi belum ditetapkan',
  VALUE_TBD: 'Ada nilai aturan yang belum ditentukan (TBD)',
  WEIGHT_CLASS_TABLE_NOT_OFFICIAL: 'Tabel kelas berat belum resmi',
  RULE_NOT_COMMITTEE_CONFIRMED: 'Aturan belum dikonfirmasi panitia',
  SCHEMA_VIOLATION: 'Struktur set aturan tidak valid',
});

export function formatDateRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
