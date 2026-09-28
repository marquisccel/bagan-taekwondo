#!/usr/bin/env node
// BaganTKD - one-command local dev launcher: `pnpm dev` (or `npm run dev`).
//
// Starts PostgreSQL (Docker), builds the API/worker, applies database migrations, then runs the
// API, the worker, and the web app together in THIS one terminal, with each line prefixed by which
// service printed it. Press Ctrl+C once to stop everything.

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';
const dbUrl = 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';
const webPort = 3001;

const COLORS = { api: '\x1b[36m', worker: '\x1b[35m', web: '\x1b[32m', setup: '\x1b[33m' };
const RESET = '\x1b[0m';

function log(name, line) {
  const color = COLORS[name] ?? '';
  process.stdout.write(`${color}[${name}]${RESET} ${line}\n`);
}

function sleepSeconds(seconds) {
  if (isWindows) {
    spawnSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Seconds ${seconds}`], {
      stdio: 'ignore',
    });
  } else {
    spawnSync('sleep', [String(seconds)], { stdio: 'ignore' });
  }
}

/** Runs a command to completion, inheriting this process's stdio; exits the whole script on failure. */
function step(name, command, args, opts = {}) {
  log('setup', `${command} ${args.join(' ')}`);
  const { env: extraEnv, cwd, ...rest } = opts;
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: isWindows,
    cwd: cwd ?? repoRoot,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    ...rest,
  });
  if (result.status !== 0) {
    log('setup', `"${name}" failed (exit ${result.status ?? result.signal}). Stopping.`);
    process.exit(result.status ?? 1);
  }
}

function waitForPostgres() {
  log('setup', 'waiting for PostgreSQL to be ready...');
  for (let i = 0; i < 30; i += 1) {
    const cid = spawnSync('docker', ['compose', 'ps', '-q', 'postgres'], { cwd: repoRoot, shell: isWindows });
    const id = cid.stdout?.toString().trim();
    if (id) {
      const health = spawnSync('docker', ['inspect', '--format={{.State.Health.Status}}', id], {
        shell: isWindows,
      });
      if (health.stdout?.toString().trim() === 'healthy') {
        log('setup', 'PostgreSQL is ready.');
        return;
      }
    }
    sleepSeconds(2);
  }
  log('setup', 'PostgreSQL did not become healthy within 60 seconds. Check: docker compose logs postgres');
  process.exit(1);
}

/** Spawns a long-running service; its stdout/stderr are streamed line-by-line with a `[name]` prefix. */
function runService(name, command, args, opts = {}) {
  const { env: extraEnv, cwd, ...rest } = opts;
  const child = spawn(command, args, {
    shell: isWindows,
    cwd: cwd ?? repoRoot,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    ...rest,
  });
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createInterface({ input: stream }).on('line', (line) => log(name, line));
  }
  child.on('exit', (code, signal) => log(name, `exited (${code ?? signal})`));
  return child;
}

step('start PostgreSQL', 'docker', ['compose', 'up', '-d', 'postgres']);
waitForPostgres();

if (!existsSync(join(repoRoot, 'node_modules'))) {
  step('install dependencies (first run only)', 'npx', ['-y', 'pnpm@10.34.5', 'install']);
}

step('build API and worker', 'npx', ['-y', 'pnpm@10.34.5', 'build']);
step('apply database migrations', 'npx', ['-y', 'pnpm@10.34.5', '--filter', '@bagantkd/db', 'migrate'], {
  env: { DATABASE_URL: dbUrl },
});

log('setup', 'starting API, worker, and web together -- press Ctrl+C once to stop all three.');
log('setup', `web app: http://localhost:${webPort}`);

const children = [
  runService('api', 'node', ['apps/api/dist/main.js'], { env: { DATABASE_URL: dbUrl } }),
  runService('worker', 'node', ['apps/worker/dist/main.js'], { env: { DATABASE_URL: dbUrl } }),
  runService('web', 'npx', ['next', 'dev', '-p', String(webPort)], { cwd: join(repoRoot, 'apps/web') }),
];

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('setup', 'stopping all services...');
  for (const child of children) child.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
