import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ENGINE_VERSION, type SimulationAssumptions } from '@bagantkd/draw-engine';
import type { RuleSet, ToleranceDimension } from '@bagantkd/rules';
import { canonicalJson, parseDrawSeed, sha256Hex, type DrawSeed } from '@bagantkd/shared';

import type { Baseline } from './baseline.js';
import { simulate } from './simulate.js';
import { renderSummary } from './summary.js';
import { defaultSyntheticOptions, generateSyntheticCsv } from './synthetic.js';

const USAGE = `Usage:
  simulate --dataset <csv> --rules <json> [--seeds 1,2,3 | --seeds range:1..20] [--golden-seed N]
           [--engine ${ENGINE_VERSION}] [--baseline <json>] [--purpose SIMULATION|CANDIDATE]
           [--assume-max POLICY:DIMENSION:VALUE ...] [--out <dir>]
  synthetic --rows <n> --seed <n> --rules <json> --out <csv>`;

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
  const datasetPath = resolve(one(m, 'dataset'));
  const datasetBytes = readFileSync(datasetPath);
  const purpose = one(m, 'purpose', 'SIMULATION');
  if (purpose !== 'SIMULATION' && purpose !== 'CANDIDATE')
    throw new Error('--purpose must be SIMULATION or CANDIDATE');
  const baselinePath = m.get('baseline')?.[0];
  const started = Date.now();
  const { report, fingerprint } = simulate({
    datasetName: datasetPath.split(/[\\/]/).pop() ?? datasetPath,
    datasetBytes,
    ruleSet: JSON.parse(readFileSync(resolve(one(m, 'rules')), 'utf-8')) as RuleSet,
    engineVersion: one(m, 'engine', ENGINE_VERSION),
    purpose,
    goldenSeed: parseDrawSeed(one(m, 'golden-seed', '20260827')),
    seeds: parseSeeds(one(m, 'seeds', '20260827')),
    assumptions: parseAssumptions(m.get('assume-max') ?? []),
    baseline: baselinePath ? (JSON.parse(readFileSync(resolve(baselinePath), 'utf-8')) as Baseline) : null,
  });
  const outDir = resolve(one(m, 'out', 'out/simulations'), fingerprint.slice(7, 19));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify({ reportFingerprint: fingerprint, volatile: { generatedAt: new Date().toISOString(), durationMs: Date.now() - started } }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'summary.md'), renderSummary(report, fingerprint));
  process.stdout.write(`${renderSummary(report, fingerprint)}\nwritten to ${outDir}\n`);
  // Exit status reflects safety only: an engine refusal is a valid, reported outcome, but a
  // non-deterministic replay or an invariant violation is a failure.
  if (!report.safety.replayIdentical || report.safety.invariantViolations > 0) process.exitCode = 2;
}

function runSynthetic(m: Map<string, string[]>): void {
  const ruleSet = JSON.parse(readFileSync(resolve(one(m, 'rules')), 'utf-8')) as RuleSet;
  const csv = generateSyntheticCsv(ruleSet, defaultSyntheticOptions(Number(one(m, 'rows')), one(m, 'seed')));
  writeFileSync(resolve(one(m, 'out')), csv);
  process.stdout.write(`sha256 ${sha256Hex(csv)}\n`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const m = args(rest);
  if (command === 'simulate') runSimulate(m);
  else if (command === 'synthetic') runSynthetic(m);
  else throw new Error(USAGE);
}

try {
  main();
} catch (e: unknown) {
  process.stderr.write(`${e instanceof Error ? e.message : canonicalJson(String(e))}\n`);
  process.exitCode = 1;
}
