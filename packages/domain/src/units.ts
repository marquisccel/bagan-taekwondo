import { DomainError } from '@bagantkd/shared';

/**
 * Physical quantities are integers in the smallest unit the engine needs: millimetres and
 * grams (ADR-0006). Parsing goes from the registration system's decimal strings directly to
 * integers, never through floating point, so "58.30" kg is exactly 58_300 g.
 */
export type HeightMm = number & { readonly __brand: 'HeightMm' };
export type WeightG = number & { readonly __brand: 'WeightG' };

const DECIMAL_RE = /^(\d+)(?:[.,](\d+))?$/;

/** Parses a non-negative decimal string into an integer of `10^scaleDigits` sub-units. */
export function parseDecimalToInteger(raw: string, scaleDigits: number): number {
  const trimmed = raw.trim();
  const m = DECIMAL_RE.exec(trimmed);
  if (!m) {
    throw new DomainError('INVALID_DECIMAL', { raw });
  }
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  const significantFrac = frac.replace(/0+$/, '');
  if (significantFrac.length > scaleDigits) {
    throw new DomainError('DECIMAL_TOO_PRECISE', { raw, scaleDigits });
  }
  const value = Number(whole) * 10 ** scaleDigits + Number(significantFrac.padEnd(scaleDigits, '0') || '0');
  if (!Number.isSafeInteger(value)) {
    throw new DomainError('DECIMAL_OUT_OF_RANGE', { raw });
  }
  return value;
}

export function heightMmFromCm(raw: string): HeightMm {
  return parseDecimalToInteger(raw, 1) as HeightMm;
}

export function weightGFromKg(raw: string): WeightG {
  return parseDecimalToInteger(raw, 3) as WeightG;
}

export function heightMm(value: number): HeightMm {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('INVALID_HEIGHT_MM', { value });
  return value as HeightMm;
}

export function weightG(value: number): WeightG {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('INVALID_WEIGHT_G', { value });
  return value as WeightG;
}

export const formatHeightCm = (h: HeightMm): string =>
  `${Math.floor(h / 10)}${h % 10 === 0 ? '' : `.${h % 10}`} cm`;

export function formatWeightKg(w: WeightG): string {
  const whole = Math.floor(w / 1000);
  const frac = String(w % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} kg`;
}
