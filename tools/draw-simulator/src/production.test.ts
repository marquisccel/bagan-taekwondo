import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { runBenchmark, validateBenchmarkArtifact, type BenchmarkArtifact } from './benchmark.js';
import { probeFingerprint } from './fingerprint-probe.js';
import { defaultSyntheticOptions, generateSyntheticCsv, generateSyntheticRows } from './synthetic.js';

/** Production readiness: determinism across processes and workers, benchmark schema, fresh CLI runs. */
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const pkg = fileURLToPath(new URL('../', import.meta.url));
const rulesPath = root('fixtures/rulesets/piala-gubernur-2026.provisional.json');
const ruleSet = JSON.parse(readFileSync(rulesPath, 'utf-8')) as RuleSet;
const tsx = ['--conditions=source', '--import', 'tsx'];

let dir: string;
let dataset: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bagantkd-prod-'));
  dataset = join(dir, 'synthetic-400.csv');
  writeFileSync(dataset, generateSyntheticCsv(ruleSet, defaultSyntheticOptions(400, '400')));
});

describe(
  'deterministic execution survives retries, process restarts and fresh workers',
  { timeout: 180_000 },
  () => {
    it('same dataset, rules, engine version and seed → one report fingerprint in-process, in two fresh processes and in a worker', async () => {
      const inProcess = probeFingerprint(dataset, rulesPath);
      expect(probeFingerprint(dataset, rulesPath)).toBe(inProcess);
      const fresh = () =>
        execFileSync(process.execPath, [...tsx, 'src/fingerprint-probe.ts', dataset, rulesPath], {
          cwd: pkg,
          encoding: 'utf-8',
        }).trim();
      expect(fresh()).toBe(inProcess);
      expect(fresh()).toBe(inProcess);
      // A fresh worker thread: register the TypeScript loader inside it, then load the probe.
      const tsxApi = pathToFileURL(createRequire(join(pkg, 'package.json')).resolve('tsx/esm/api')).href;
      const probeUrl = pathToFileURL(join(pkg, 'src/fingerprint-probe.ts')).href;
      const bootstrap = `import(${JSON.stringify(tsxApi)}).then((m) => { m.register(); return import(${JSON.stringify(probeUrl)}); });`;
      const fromWorker = await new Promise<string>((resolvePromise, reject) => {
        const w = new Worker(bootstrap, {
          eval: true,
          execArgv: ['--conditions=source'],
          workerData: { dataset, rules: rulesPath },
        });
        w.once('message', (m: string) => {
          resolvePromise(m);
          void w.terminate();
        });
        w.once('error', reject);
      });
      expect(fromWorker).toBe(inProcess);
    });

    it('a fresh CLI simulation of a generated dataset is SAFE, fully accounted and reproducible', () => {
      const run = () =>
        execFileSync(
          process.execPath,
          [
            ...tsx,
            'src/cli.ts',
            'simulate',
            '--dataset',
            dataset,
            '--rules',
            rulesPath,
            '--seeds',
            '1',
            '--out',
            join(dir, 'sim'),
          ],
          {
            cwd: pkg,
            encoding: 'utf-8',
            env: { ...process.env, INIT_CWD: pkg },
          },
        );
      const a = run();
      const b = run();
      const fp = (s: string) => /Report fingerprint: `(sha256:[0-9a-f]{64})`/.exec(s)?.[1];
      expect(fp(a)).toBeDefined();
      expect(fp(b)).toBe(fp(a));
      expect(a).toContain('| All seeds produced a SAFE draw | yes |');
      expect(a).toContain('accounted: yes');
    });
  },
);

describe('benchmark artifact', () => {
  const env = {
    now: (() => {
      let t = 0;
      return () => (t += 5);
    })(),
    isoNow: () => '2026-09-12T00:00:00.000Z',
    memory: () => ({ rss: 200 * 1_048_576, heapUsed: 80 * 1_048_576 }),
    platform: { os: 'test', arch: 'x64', cpuModel: 'test cpu', cpus: 4, totalMemGb: 16, node: 'v24' },
  };
  let artifact: BenchmarkArtifact;
  beforeAll(() => {
    artifact = runBenchmark({
      name: 'SYNTHETIC_400',
      datasetName: 'synthetic-400',
      bytes: readFileSync(dataset),
      synthetic: { rows: 400, seed: '400' },
      ruleSet,
      seeds: [parseDrawSeed('20260827'), parseDrawSeed('1')],
      readinessOverride: null,
      env,
    });
  });

  it('matches the schema and records fingerprint, version, seeds, counts, durations, memory and platform', () => {
    expect(validateBenchmarkArtifact(artifact)).toEqual([]);
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      allSafe: true,
      identicalAcrossRuns: true,
      seeds: ['20260827', '1'],
    });
    expect(artifact.counts.placed).toBeGreaterThan(0);
    expect(artifact.counts.placed).toBeLessThanOrEqual(artifact.counts.eligible);
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
  });

  it('the schema check rejects incomplete artifacts', () => {
    const broken = {
      ...artifact,
      counts: { ...artifact.counts, pools: undefined },
      dataset: { ...artifact.dataset, fingerprint: 'x' },
    };
    expect(validateBenchmarkArtifact(broken)).toEqual(
      expect.arrayContaining(['dataset.fingerprint', 'counts.pools']),
    );
    expect(validateBenchmarkArtifact(null)).toEqual(['not an object']);
  });

  it('contains no personal data of the dataset (names, NIK, birth dates, registration ids)', () => {
    const text = JSON.stringify(artifact);
    const rows = generateSyntheticRows(ruleSet, defaultSyntheticOptions(400, '400'));
    for (const r of rows) {
      expect(text).not.toContain(r.nik);
      expect(text).not.toContain(r.namalengkap);
      expect(text).not.toContain(r.tanggallahir);
      expect(text).not.toContain(`"${r.id_athlete}"`);
    }
  });
});
