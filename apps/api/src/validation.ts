import { ApiError } from './errors/api-error';

/** Minimal request-body validation (Phase 4 is deliberately zod-free at the HTTP boundary — see
 * `packages/domain/src/commands.ts`, which has no runtime schema either). Every accessor throws
 * `VALIDATION_ERROR` (400) with a field name, never a stack trace. */
export function body(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ApiError('VALIDATION_ERROR', 'request body must be a JSON object');
  return value as Record<string, unknown>;
}

export function str(b: Record<string, unknown>, field: string): string {
  const v = b[field];
  if (typeof v !== 'string' || v.length === 0)
    throw new ApiError('VALIDATION_ERROR', `${field} must be a non-empty string`);
  return v;
}

export function strOrNull(b: Record<string, unknown>, field: string): string | null {
  const v = b[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ApiError('VALIDATION_ERROR', `${field} must be a string or null`);
  return v;
}

export function num(b: Record<string, unknown>, field: string): number {
  const v = b[field];
  if (typeof v !== 'number' || !Number.isInteger(v))
    throw new ApiError('VALIDATION_ERROR', `${field} must be an integer`);
  return v;
}

export function numOrNull(b: Record<string, unknown>, field: string): number | null {
  const v = b[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v))
    throw new ApiError('VALIDATION_ERROR', `${field} must be an integer or null`);
  return v;
}

export function oneOf<T extends string>(b: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = b[field];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    throw new ApiError('VALIDATION_ERROR', `${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}
