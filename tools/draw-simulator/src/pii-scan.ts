import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * PII audit helpers (ADR-0014). Committed files, reports and CLI output must never carry a real
 * NIK, name or birth date. NIK-shaped values (16 isolated digits) in committed files must be
 * synthetic: region code 99 (no such province) or the documented synthetic fixture generator.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'data',
  '.next',
  'coverage',
  '.turbo',
  '.claude',
]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|csv|ya?ml|sql|py|html|txt)$/;

/** Every text file of the repository that could be committed (ignored folders excluded). */
export function repositoryTextFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (TEXT.test(name)) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Isolated 16-digit runs (not part of a longer digit run or a hex string such as a fingerprint). */
export const NIK_SHAPED = /(?<![0-9a-fA-F])\d{16}(?![0-9a-fA-F])/g;

/** Synthetic by construction: generated dirty-case fixture (tests rely on its exact values). */
export const SYNTHETIC_NIK_FILES = [
  'fixtures/intake/dirty-cases.csv',
  'fixtures/intake/dirty-cases.expected.json',
];

export function nonSyntheticNikShapedValues(root: string): { file: string; value: string }[] {
  const found: { file: string; value: string }[] = [];
  for (const f of repositoryTextFiles(root)) {
    const rel = relative(root, f).replaceAll('\\', '/');
    if (SYNTHETIC_NIK_FILES.includes(rel)) continue;
    for (const m of readFileSync(f, 'utf-8').matchAll(NIK_SHAPED)) {
      if (!m[0].startsWith('99')) found.push({ file: rel, value: `${m[0].slice(0, 4)}…` });
    }
  }
  return found;
}

/** Real identifiers of a private dataset that must never leave it (normalized NIK digits, full names). */
export function privateIdentifiers(csv: string): { niks: Set<string>; names: Set<string> } {
  const bom = String.fromCharCode(0xfeff);
  const lines = (csv.startsWith(bom) ? csv.slice(1) : csv).split(/\r?\n/);
  const header = (lines[0] ?? '').split(',');
  const nikCol = header.indexOf('nik');
  const nameCol = header.indexOf('namalengkap');
  const niks = new Set<string>();
  const names = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const nik = (cells[nikCol] ?? '').replace(/\D/g, '');
    if (nik.length >= 12) niks.add(nik);
    const name = (cells[nameCol] ?? '').replace(/"/g, '').trim().split(/\s+/).join(' ');
    if (name.length >= 10) names.add(name);
  }
  return { niks, names };
}

export function findPrivateIdentifiers(
  text: string,
  ids: { niks: Set<string>; names: Set<string> },
): string[] {
  const hits: string[] = [];
  for (const n of ids.niks) if (text.includes(n)) hits.push('NIK');
  for (const n of ids.names) if (text.includes(n)) hits.push(`NAME(${n.length} chars)`);
  return hits;
}
