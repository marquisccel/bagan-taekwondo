/**
 * Historical quality benchmark (ADR-0012). Comparing against the 2026 committee draw tells us
 * whether quality is at least as good as what people achieved by hand. It never decides
 * correctness: a draw that beats the baseline but breaks a safety invariant is rejected, and a
 * draw that loses to the baseline on one metric is reported, not rejected.
 */
export type Direction = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'INFO';

export interface BaselineMetric {
  readonly value: number;
  readonly direction: Direction;
  readonly unit: string;
  readonly note?: string;
}

export interface Baseline {
  readonly code: string;
  readonly kind: 'HISTORICAL_QUALITY_BENCHMARK';
  readonly semiPrestasi: {
    readonly singletonPools: BaselineMetric;
    readonly kyorugi: Readonly<Record<string, BaselineMetric>>;
    readonly poomsae: Readonly<Record<string, BaselineMetric>>;
  };
}

export type ComparisonStatus = 'BETTER' | 'EQUAL' | 'WORSE' | 'INFO' | 'NOT_AVAILABLE';

export interface MetricComparison {
  readonly metric: string;
  readonly unit: string;
  readonly direction: Direction;
  readonly baseline: number;
  readonly engine: number | null;
  readonly status: ComparisonStatus;
}

/** Flattens the baseline into `group.metric` keys that the engine's quality metrics use. */
export function baselineMetrics(b: Baseline): Map<string, BaselineMetric> {
  const out = new Map<string, BaselineMetric>();
  out.set('semiPrestasi.singletonPools', b.semiPrestasi.singletonPools);
  for (const [k, v] of Object.entries(b.semiPrestasi.kyorugi)) out.set(`semiPrestasi.kyorugi.${k}`, v);
  for (const [k, v] of Object.entries(b.semiPrestasi.poomsae)) out.set(`semiPrestasi.poomsae.${k}`, v);
  return out;
}

export function compareToBaseline(
  b: Baseline,
  engineMetrics: Readonly<Record<string, number>>,
): MetricComparison[] {
  return [...baselineMetrics(b)].map(([metric, m]) => {
    const engine = engineMetrics[metric] ?? null;
    let status: ComparisonStatus;
    if (engine === null) status = 'NOT_AVAILABLE';
    else if (m.direction === 'INFO') status = 'INFO';
    else if (engine === m.value) status = 'EQUAL';
    else status = (m.direction === 'HIGHER_IS_BETTER') === engine > m.value ? 'BETTER' : 'WORSE';
    return { metric, unit: m.unit, direction: m.direction, baseline: m.value, engine, status };
  });
}
