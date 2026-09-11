import { invariant } from './errors.js';

/**
 * Fixed-point arithmetic for engine costs. A cost of 1.0 is represented as FP_SCALE.
 * Integer-only arithmetic keeps costs bit-identical across platforms and makes every
 * stored cost an exact integer that can be compared, summed and fingerprinted safely.
 */
export const FP_SCALE = 10_000;

export type Fp = number & { readonly __brand: 'Fp' };

export function fp(integerTimesScale: number): Fp {
  assertSafeInteger(integerTimesScale, 'FP_NOT_SAFE_INTEGER');
  return integerTimesScale as Fp;
}

export function fpFromInt(n: number): Fp {
  assertSafeInteger(n, 'FP_NOT_SAFE_INTEGER');
  return fp(n * FP_SCALE);
}

/** floor(numerator * FP_SCALE / denominator) for non-negative integers; denominator > 0. */
export function fpRatio(numerator: number, denominator: number): Fp {
  assertSafeInteger(numerator, 'FP_NOT_SAFE_INTEGER');
  assertSafeInteger(denominator, 'FP_NOT_SAFE_INTEGER');
  invariant(numerator >= 0 && denominator > 0, 'FP_RATIO_DOMAIN', { numerator, denominator });
  return fp(Number((BigInt(numerator) * BigInt(FP_SCALE)) / BigInt(denominator)));
}

/** floor(a * b / FP_SCALE) for non-negative values. */
export function fpMul(a: Fp, b: Fp): Fp {
  invariant(a >= 0 && b >= 0, 'FP_MUL_DOMAIN', { a, b });
  return fp(Number((BigInt(a) * BigInt(b)) / BigInt(FP_SCALE)));
}

export function fpAdd(...values: readonly Fp[]): Fp {
  let sum = 0;
  for (const v of values) {
    sum += v;
    assertSafeInteger(sum, 'FP_OVERFLOW');
  }
  return fp(sum);
}

/** Integer weight (per mille, per cent, …) times a cost: floor(weight * cost). */
export function fpScale(cost: Fp, integerWeight: number): Fp {
  assertSafeInteger(integerWeight, 'FP_NOT_SAFE_INTEGER');
  invariant(integerWeight >= 0 && cost >= 0, 'FP_SCALE_DOMAIN', { integerWeight, cost });
  return fp(Number(BigInt(cost) * BigInt(integerWeight)));
}

export function fpToDisplay(value: Fp, decimals = 4): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs / FP_SCALE);
  const frac = String(abs % FP_SCALE)
    .padStart(4, '0')
    .slice(0, decimals);
  return decimals > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

function assertSafeInteger(n: number, code: string): void {
  invariant(Number.isSafeInteger(n), code, { value: n });
}
