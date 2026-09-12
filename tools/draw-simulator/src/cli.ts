import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ENGINE_VERSION, type SimulationAssumptions } from '@bagantkd/draw-engine';
import type { RuleSet, ToleranceDimension } from '@bagantkd/rules';
import { canonicalJson, parseDrawSeed, sha256Hex, type DrawSeed } from '@bagantkd/shared';

import { runIntake, type BaselineCounts, type BaselineDetail } from '@bagantkd/intake';

import type { Baseline } from './baseline.js';
import { runBenchmark, validateBenchmarkArtifact } from './benchmark.js';
import { buildIntakeReport, renderIntakeReport } from './intake-report.js';
import { simulate } from './simulate.js';
import { renderSummary, timingSpread } from './summary.js';
import { defaultSyntheticOptions, generateSyntheticCsv } from './synthetic.js';

const USAGE = `Usage:
  simulate --dataset <csv> --rules <json> [--seeds 1,2,3 | --seeds range:1..20] [--golden-seed N]
           [--engine ${ENGINE_VERSION}] [--baseline <json>] [--purpose SIMULATION|CANDIDATE]
           [--assume-max POLICY:DIMENSION:VALUE ...] [--scope READY|ALL] [--replay N] [--out <dir>]
  synthetic --rows <n> --seed <n> --rules <json> --out <csv>
  intake-report --dataset <csv> --rules <json> [--baseline <counts.json>] [--baseline-detail <detail.json>] [--out <dir>]
  benchmark --name <NAME> (--dataset <csv> | --synthetic <rows> [--synthetic-seed N]) --rules <json>
            [--seeds 20260827,1,2] [--readiness DRAW_ELIGIBLE_ONLY] --out <file.json>`;

function args(argv: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k?.startsWith('--')) throw new Error(`unexpected argument ${String(k)}\n${USAGE}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${k}`);
    m.set(k.slice(2), [...(m.get(k.slice(2)) ?? []), v]);
    i += 1;
  }
  return m;
}

/** User paths are relative to where the command was typed (pnpm runs the script in the package dir). */
const fromCwd = (p: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), p);

const one = (m: Map<string, string[]>, k: string, fallback?: string): string => {
  const v = m.get(k)?.[0] ?? fallback;
  if (v === undefined) throw new Error(`--${k} is required\n${USAGE}`);
  return v;
};

function parseSeeds(spec: string): DrawSeed[] {
  const range = /^range:(\d+)\.\.(\d+)$/.exec(spec);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    return Array.from({ length: to - from + 1 }, (_, i) => parseDrawSeed(String(from + i)));
  }
  return spec.split(',').map((s) => parseDrawSeed(s.trim()));
}

function parseAssumptions(values: readonly string[]): SimulationAssumptions | null {
  if (values.length === 0) return null;
  return {
    maxTolerances: values.map((v) => {
      const [policyCode, dimension, value] = v.split(':');
      if (!policyCode || !dimension || !value || !['WEIGHT', 'HEIGHT', 'BELT'].includes(dimension)) {
        throw new Error(`--assume-max expects POLICY:WEIGHT|HEIGHT|BELT:VALUE, got ${v}`);
      }
      return {
        policyCode,
        dimension: dimension as ToleranceDimension,
        ageDivisionCode: null,
        value: Number(value),
      };
    }),
  };
}

function runSimulate(m: Map<string, string[]>): void {
  const datasetPath = fromCwd(one(m, 'dataset'));
  const datasetBytes = readFileSync(datasetPath);
  const purpose = one(m, 'purpose', 'SIMULATION');
  if (purpose !== 'SIMULATION' && purpose !== 'CANDIDATE')
    throw new Error('--purpose must be SIMULATION or CANDIDATE');
  const baselinePath = m.get('baseline')?.[0];
  const scopeMode = one(m, 'scope', 'READY');
  if (scopeMode !== 'READY' && scopeMode !== 'ALL') throw new Error('--scope must be READY or ALL');
  const started = Date.now();
  const { report, fingerprint, volatile } = simulate({
    datasetName: datasetPath.split(/[\\/]/).pop() ?? datasetPath,
    datasetBytes,
    ruleSet: JSON.parse(readFileSync(fromCwd(one(m, 'rules')), 'utf-8')) as RuleSet,
    engineVersion: one(m, 'engine', ENGINE_VERSION),
    purpose,
    goldenSeed: parseDrawSeed(one(m, 'golden-seed', '20260827')),
    seeds: parseSeeds(one(m, 'seeds', '20260827')),
    assumptions: parseAssumptions(m.get('assume-max') ?? []),
    baseline: baselinePath ? (JSON.parse(readFileSync(fromCwd(baselinePath), 'utf-8')) as Baseline) : null,
    scopeMode,
    replayRuns: Number(one(m, 'replay', '2')),
    now: () => performance.now(),
  });
  const outDir = resolve(fromCwd(one(m, 'out', 'out/simulations')), fingerprint.slice(7, 19));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify({ reportFingerprint: fingerprint, volatile: { generatedAt: new Date().toISOString(), durationMs: Date.now() - started, ...volatile, seedTiming: timingSpread(Object.values(volatile.seedMs)) } }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'summary.md'), renderSummary(report, fingerprint, volatile));
  process.stdout.write(`${renderSummary(report, fingerprint, volatile)}\nwritten to ${outDir}\n`);
  // Exit status reflects safety only: an engine refusal is a valid, reported outcome, but a
  // non-deterministic replay or an invariant violation is a failure.
  if (!report.safety.replayIdentical || report.safety.invariantViolations > 0) process.exitCode = 2;
}

function runSynthetic(m: Map<string, string[]>): void {
  const ruleSet = JSON.parse(readFileSync(fromCwd(one(m, 'rules')), 'utf-8')) as RuleSet;
  const csv = generateSyntheticCsv(ruleSet, defaultSyntheticOptions(Number(one(m, 'rows')), one(m, 'seed')));
  writeFileSync(fromCwd(one(m, 'out')), csv);
  process.stdout.write(`sha256 ${sha256Hex(csv)}\n`);
}

function runIntakeReport(m: Map<string, string[]>): void {
  const datasetPath = fromCwd(one(m, 'dataset'));
  const ruleSet = JSON.parse(readFileSync(fromCwd(one(m, 'rules')), 'utf-8')) as RuleSet;
  const result = runIntake({
    sourceName: datasetPath.split(/[\\/]/).pop() ?? datasetPath,
    bytes: readFileSync(datasetPath),
    ruleSet,
  });
  if (result.fatal)
    throw new Error(`intake failed: ${result.fatal.code} ${JSON.stringify(result.fatal.params)}`);
  const json = (k: string): unknown => {
    const p = m.get(k)?.[0];
    return p ? JSON.parse(readFileSync(fromCwd(p), 'utf-8')) : null;
  };
  const { report, fingerprint } = buildIntakeReport({
    result,
    ruleSet,
    baselineCounts: json('baseline') as BaselineCounts | null,
    baselineDetail: json('baseline-detail') as BaselineDetail | null,
  });
  const outDir = fromCwd(one(m, 'out', 'out/intake'));
  mkdirSync(outDir, { recursive: true });
  // Aggregates only (no personal data): safe to commit.
  const writeJson = (name: string, value: unknown) => {
    writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson('transformation-report.json', report.transformation);
  writeJson('differential-report.json', report.differential);
  writeJson('engine-stages.json', report.engine);
  writeFileSync(join(outDir, 'intake-report.md'), renderIntakeReport(report, fingerprint));
  process.stdout.write(`${renderIntakeReport(report, fingerprint)}\nwritten to ${outDir}\n`);
  const d = report.differential;
  if (d.aggregate.differences.length > 0 || d.detail.rowDifferences > 0 || d.detail.entryDifferences > 0)
    process.exitCode = 2;
}

function runBenchmarkCommand(m: Map<string, string[]>): void {
  const ruleSet = JSON.parse(readFileSync(fromCwd(one(m, 'rules')), 'utf-8')) as RuleSet;
  const syntheticRows = m.get('synthetic')?.[0];
  const synthetic = syntheticRows
    ? { rows: Number(syntheticRows), seed: one(m, 'synthetic-seed', syntheticRows) }
    : null;
  const datasetPath = synthetic ? null : fromCwd(one(m, 'dataset'));
  const bytes = synthetic
    ? new TextEncoder().encode(
        generateSyntheticCsv(ruleSet, defaultSyntheticOptions(synthetic.rows, synthetic.seed)),
      )
    : readFileSync(datasetPath ?? '');
  const readiness = m.get('readiness')?.[0] ?? null;
  if (readiness !== null && readiness !== 'DRAW_ELIGIBLE_ONLY')
    throw new Error('--readiness must be DRAW_ELIGIBLE_ONLY');
  const cpu = cpus();
  const artifact = runBenchmark({
    name: one(m, 'name'),
    datasetName: synthetic ? `synthetic-${synthetic.rows}` : ((datasetPath ?? '').split(/[\\/]/).pop() ?? ''),
    bytes,
    synthetic,
    ruleSet,
    seeds: parseSeeds(one(m, 'seeds', '20260827')),
    readinessOverride: readiness,
    env: {
      now: () => performance.now(),
      isoNow: () => new Date().toISOString(),
      memory: () => process.memoryUsage(),
      platform: {
        os: `${platform()} ${release()}`,
        arch: arch(),
        cpuModel: cpu[0]?.model.trim() ?? 'unknown',
        cpus: cpu.length,
        totalMemGb: Math.round(totalmem() / 1_073_741_824),
        node: process.version,
      },
    },
  });
  const problems = validateBenchmarkArtifact(artifact);
  if (problems.length > 0) throw new Error(`benchmark artifact invalid: ${problems.join(', ')}`);
  const out = fromCwd(one(m, 'out'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  const c = artifact.counts;
  const d = artifact.durationsMs;
  process.stdout.write(
    `${artifact.benchmark}: ${artifact.dataset.rows} rows, ${c.entries} entries, ${c.eligible} eligible, ${c.categories} categories (${c.categoriesReady} ready), ${c.placed} placed in ${c.pools} pools\n` +
      `  ${artifact.allSafe ? 'SAFE' : 'NOT SAFE'}, retry identical: ${artifact.identicalAcrossRuns}; per seed p50 ${d.perSeed.p50} ms, p95 ${d.perSeed.p95} ms, max ${d.perSeed.max} ms; rss peak ${artifact.memory.rssPeakMb} MB\n` +
      `  output ${artifact.results[0]?.outputFingerprint ?? '-'}\n  written to ${out}\n`,
  );
  if (!artifact.allSafe || !artifact.identicalAcrossRuns) process.exitCode = 2;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const m = args(rest);
  if (command === 'simulate') runSimulate(m);
  else if (command === 'synthetic') runSynthetic(m);
  else if (command === 'intake-report') runIntakeReport(m);
  else if (command === 'benchmark') runBenchmarkCommand(m);
  else throw new Error(USAGE);
}

try {
  main();
} catch (e: unknown) {
  process.stderr.write(`${e instanceof Error ? e.message : canonicalJson(String(e))}\n`);
  process.exitCode = 1;
}
