import { customType, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

export const id = () => uuid('id').primaryKey().defaultRandom();
export const nowTs = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const createdAt = () => nowTs('created_at');
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Provenance of a rule value: { source, note? } (packages/rules PROVENANCE_SOURCES). */
export const provenance = (name: string) => jsonb(name).$type<{ source: string; note?: string }>();
