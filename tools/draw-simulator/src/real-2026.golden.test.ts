import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINE_VERSION } from '@bagantkd/draw-engine';
import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed, sha256Hex } from '@bagantkd/shared';
import { describe, expect, it } from 'vitest';

import type { Baseline } from './baseline.js';
import { parseCsv } from '@bagantkd/intake';
import { simulate } from './simulate.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const manifest = JSON.parse(readFileSync(root('fixtures/datasets/manifest.json'), 'utf-8')) as {
  datasets: { REAL_2026: { path: string; sha256: string; rows: number; columns: number } };
  goldenSeed: string;
  robustnessSeeds: string[];
};
const spec = manifest.datasets.REAL_2026;
const datasetPath = process.env['GOLDEN_DATASET_PATH']
  ? root(process.env['GOLDEN_DATASET_PATH'])
  : root(spec.path);
const available = existsSync(datasetPath);

if (!available) {
  process.stdout.write(
    `\n  [golden] SKIPPED: private dataset not found at ${datasetPath} (see data/README.md)\n`,
  );
}

describe.skipIf(!available)('golden dataset: Piala Gubernur 2026 registrations', () => {
  const bytes = available ? readFileSync(datasetPath) : new Uint8Array();

  it('is the exact, unmodified source file', () => {
    expect(sha256Hex(bytes)).toBe(spec.sha256);
  });

  it('parses to 3,154 rows × 13 columns (the file has no trailing newline)', () => {
    const t = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    expect(t.header).toHaveLength(spec.columns);
    expect(t.rows).toHaveLength(spec.rows);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a);
  });

  it('runs through the simulator deterministically for the golden seed and the robustness seeds', () => {
    const request = {
      datasetName: 'REAL_2026',
      datasetBytes: bytes,
      ruleSet: JSON.parse(
        readFileSync(root('fixtures/rulesets/piala-gubernur-2026.provisional.json'), 'utf-8'),
      ) as RuleSet,
      engineVersion: ENGINE_VERSION,
      purpose: 'SIMULATION' as const,
      goldenSeed: parseDrawSeed(manifest.goldenSeed),
      seeds: manifest.robustnessSeeds.slice(0, 2).map(parseDrawSeed),
      assumptions: null,
      baseline: JSON.parse(readFileSync(root('fixtures/baselines/committee-2026.json'), 'utf-8')) as Baseline,
    };
    const a = simulate(request);
    const b = simulate(request);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.report.dataset.rows).toBe(3154);
    expect(a.report.seeds).toHaveLength(3);
    expect(a.report.safety).toEqual({
      allSeedsSafe: true,
      invariantViolations: 0,
      replayIdentical: true,
      reasons: [],
    });
  });
});
