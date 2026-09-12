import { ENGINE_VERSION, runDraw, type EngineOutput } from '@bagantkd/draw-engine';
import { runIntake } from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import type { DrawSeed, Fingerprint } from '@bagantkd/shared';

import { SIMULATOR_VERSION } from './simulate.js';
import { timingSpread } from './summary.js';

/**
 * Reproducible benchmark (Phase 3 hardening): one dataset, a list of seeds, a machine-readable
 * artifact. Aggregates only — no names, NIK, birth dates or registration ids.
 */
export const BENCHMARK_SCHEMA_VERSION = 1;

export interface BenchmarkArtifact {
  readonly schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  readonly benchmark: string;
  readonly generatedAt: string;
  readonly engineVersion: string;
  readonly simulatorVersion: string;
  readonly dataset: {
    readonly name: string;
    readonly fingerprint: Fingerprint;
    readonly rows: number;
    readonly synthetic: { readonly rows: number; readonly seed: string } | null;
  };
  readonly ruleSet: { readonly code: string; readonly readinessOverride: string | null };
  readonly seeds: readonly string[];
  readonly counts: {
    readonly entries: number;
    readonly eligible: number;
    readonly withheld: number;
    readonly categories: number;
    readonly categoriesReady: number;
    readonly categoriesBlocked: number;
    readonly placed: number;
    readonly pools: number;
    readonly walkovers: number;
  };
  readonly results: readonly {
    readonly seed: string;
    readonly status: string;
    readonly outputFingerprint: Fingerprint;
    readonly ms: number;
  }[];
  readonly allSafe: boolean;
  readonly identicalAcrossRuns: boolean;
  readonly durationsMs: {
    readonly intake: number;
    readonly plan: number;
    readonly perSeed: { readonly p50: number; readonly p95: number; readonly max: number };
  };
  readonly memory: { readonly rssPeakMb: number; readonly heapUsedPeakMb: number };
  readonly platform: {
    readonly os: string;
    readonly arch: string;
    readonly cpuModel: string;
    readonly cpus: number;
    readonly totalMemGb: number;
    readonly node: string;
  };
}

export interface BenchmarkEnv {
  readonly now: () => number;
  readonly isoNow: () => string;
  readonly memory: () => { rss: number; heapUsed: number };
  readonly platform: BenchmarkArtifact['platform'];
}

export function runBenchmark(args: {
  readonly name: string;
  readonly datasetName: string;
  readonly bytes: Uint8Array;
  readonly synthetic: { rows: number; seed: string } | null;
  readonly ruleSet: RuleSet;
  readonly seeds: readonly DrawSeed[];
  /** What-if: draw every eligible entry (`DRAW_ELIGIBLE_ONLY`) instead of the rule set's readiness policy. */
  readonly readinessOverride: 'DRAW_ELIGIBLE_ONLY' | null;
  readonly env: BenchmarkEnv;
}): BenchmarkArtifact {
  const { env } = args;
  let rss = 0;
  let heap = 0;
  const sample = () => {
    const m = env.memory();
    rss = Math.max(rss, m.rss);
    heap = Math.max(heap, m.heapUsed);
  };
  const rs: RuleSet = args.readinessOverride
    ? {
        ...args.ruleSet,
        categoryReadiness: {
          withheldEntries: args.readinessOverride,
          provenance: { source: 'ENGINEERING_DEFAULT', note: 'benchmark what-if' },
        },
      }
    : args.ruleSet;
  let t = env.now();
  const intake = runIntake({ sourceName: args.datasetName, bytes: args.bytes, ruleSet: rs });
  const intakeMs = env.now() - t;
  sample();
  if (!intake.snapshot) throw new Error(`intake failed: ${intake.fatal?.code ?? 'unknown'}`);
  const entries = intake.snapshot.entries;
  const run = (seed: DrawSeed, scope: readonly string[]): EngineOutput =>
    runDraw({
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION',
      seed,
      ruleSet: rs,
      entries,
      scope,
      assumptions: null,
    });

  const first = args.seeds[0];
  if (!first) throw new Error('at least one seed is required');
  t = env.now();
  const plan = run(first, []);
  const planMs = env.now() - t;
  sample();
  const scope = plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey);
  const results: { seed: string; status: string; outputFingerprint: Fingerprint; ms: number }[] = [];
  let golden: EngineOutput | null = null;
  for (const seed of args.seeds) {
    t = env.now();
    const out = run(seed, scope);
    const ms = Math.round(env.now() - t);
    sample();
    golden ??= out;
    results.push({ seed, status: out.status, outputFingerprint: out.fingerprints.output, ms });
  }
  // Retry: the first seed once more must reproduce its fingerprint.
  const retry = run(first, scope);
  sample();
  const m = golden?.quality.metrics ?? {};
  const pm = plan.quality.metrics;
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    benchmark: args.name,
    generatedAt: env.isoNow(),
    engineVersion: ENGINE_VERSION,
    simulatorVersion: SIMULATOR_VERSION,
    dataset: {
      name: args.datasetName,
      fingerprint: intake.source.fingerprint,
      rows: intake.source.rows,
      synthetic: args.synthetic,
    },
    ruleSet: { code: rs.code, readinessOverride: args.readinessOverride },
    seeds: args.seeds.map(String),
    counts: {
      entries: pm['entries'] ?? 0,
      eligible: pm['entriesEligible'] ?? 0,
      withheld: pm['entriesWithheld'] ?? 0,
      categories: pm['categories'] ?? 0,
      categoriesReady: pm['categoriesReady'] ?? 0,
      categoriesBlocked: pm['categoriesBlocked'] ?? 0,
      placed: m['entriesPlaced'] ?? 0,
      pools: m['pools'] ?? 0,
      walkovers: m['poolsWalkover'] ?? 0,
    },
    results,
    allSafe: results.every((r) => r.status === 'SAFE'),
    identicalAcrossRuns: retry.fingerprints.output === results[0]?.outputFingerprint,
    durationsMs: {
      intake: Math.round(intakeMs),
      plan: Math.round(planMs),
      perSeed: timingSpread(results.map((r) => r.ms)),
    },
    memory: { rssPeakMb: Math.round(rss / 1_048_576), heapUsedPeakMb: Math.round(heap / 1_048_576) },
    platform: args.env.platform,
  };
}

/** Schema check for benchmark artifacts (returns the problems; empty = valid). */
export function validateBenchmarkArtifact(x: unknown): string[] {
  const problems: string[] = [];
  const o = x as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null) return ['not an object'];
  const need = (path: string, ok: boolean) => {
    if (!ok) problems.push(path);
  };
  const obj = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  need('schemaVersion', o['schemaVersion'] === BENCHMARK_SCHEMA_VERSION);
  for (const k of ['benchmark', 'generatedAt', 'engineVersion', 'simulatorVersion'])
    need(k, typeof o[k] === 'string');
  const d = obj(o['dataset']);
  need(
    'dataset.fingerprint',
    typeof d['fingerprint'] === 'string' && /^sha256:[0-9a-f]{64}$/.test(d['fingerprint']),
  );
  need('dataset.rows', isNum(d['rows']));
  need(
    'seeds',
    Array.isArray(o['seeds']) &&
      (o['seeds'] as unknown[]).length > 0 &&
      (o['seeds'] as unknown[]).every((s) => typeof s === 'string'),
  );
  const c = obj(o['counts']);
  for (const k of [
    'entries',
    'eligible',
    'withheld',
    'categories',
    'categoriesReady',
    'categoriesBlocked',
    'placed',
    'pools',
    'walkovers',
  ])
    need(`counts.${k}`, isNum(c[k]));
  need(
    'results',
    Array.isArray(o['results']) &&
      (o['results'] as unknown[]).length === (o['seeds'] as unknown[] | undefined)?.length,
  );
  need('allSafe', typeof o['allSafe'] === 'boolean');
  need('identicalAcrossRuns', typeof o['identicalAcrossRuns'] === 'boolean');
  const dur = obj(o['durationsMs']);
  const per = obj(dur['perSeed']);
  need(
    'durationsMs',
    isNum(dur['intake']) && isNum(dur['plan']) && isNum(per['p50']) && isNum(per['p95']) && isNum(per['max']),
  );
  const mem = obj(o['memory']);
  need('memory', isNum(mem['rssPeakMb']) && isNum(mem['heapUsedPeakMb']));
  const p = obj(o['platform']);
  need(
    'platform',
    ['os', 'arch', 'cpuModel', 'node'].every((k) => typeof p[k] === 'string') &&
      isNum(p['cpus']) &&
      isNum(p['totalMemGb']),
  );
  return problems;
}
