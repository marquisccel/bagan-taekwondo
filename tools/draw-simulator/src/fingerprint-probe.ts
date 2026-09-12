import { readFileSync } from 'node:fs';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

import { ENGINE_VERSION } from '@bagantkd/draw-engine';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';

import { simulate } from './simulate.js';

/**
 * Determinism probe: computes the simulation report fingerprint of one dataset in a fresh process
 * (`node … fingerprint-probe.ts <csv> <rules>`) or a fresh worker thread (workerData). Tests compare
 * it with the in-process result to prove that restarts and workers do not change the draw.
 */
export function probeFingerprint(datasetPath: string, rulesPath: string): string {
  return simulate({
    datasetName: 'probe.csv',
    datasetBytes: readFileSync(datasetPath),
    ruleSet: JSON.parse(readFileSync(rulesPath, 'utf-8')) as RuleSet,
    engineVersion: ENGINE_VERSION,
    purpose: 'SIMULATION',
    goldenSeed: parseDrawSeed('20260827'),
    seeds: [parseDrawSeed('1')],
    assumptions: null,
    baseline: null,
  }).fingerprint;
}

if (!isMainThread && parentPort) {
  const { dataset, rules } = workerData as { dataset: string; rules: string };
  parentPort.postMessage(probeFingerprint(dataset, rules));
} else if (process.argv[1]?.endsWith('fingerprint-probe.ts') && process.argv[2] && process.argv[3]) {
  process.stdout.write(`${probeFingerprint(process.argv[2], process.argv[3])}\n`);
}
