-- AUD-012: a dedicated PDF export type for the dense semi-prestasi tournament-desk draw sheet.
-- Rendering-only: no table/column changes, only a new export_type enum value. The value is not used
-- in this migration (drizzle applies every pending migration in one transaction, and PostgreSQL
-- forbids USING a value added earlier in the same transaction), and IF NOT EXISTS keeps the
-- statement re-runnable.
ALTER TYPE "public"."export_type" ADD VALUE IF NOT EXISTS 'SEMI_PRESTASI_COMPACT_DRAW_SHEET';
