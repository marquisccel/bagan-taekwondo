/**
 * Stable, machine-readable error. `code` is part of the public contract (API responses,
 * audit events, simulator reports); human-readable text is rendered from templates
 * elsewhere, never parsed from `message`.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(code: string, params: Record<string, unknown> = {}, message?: string) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

export type Result<T, E = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function invariant(
  condition: unknown,
  code: string,
  params: Record<string, unknown> = {},
): asserts condition {
  if (!condition) {
    throw new DomainError(code, params);
  }
}
