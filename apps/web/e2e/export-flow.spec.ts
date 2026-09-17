import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { baseRuleSet, lockableRuleSet, seedTournament, type SeededTournament } from './seed';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';
/** Must match the API webServer's EXPORT_STORAGE_DIR in playwright.config.ts, so the download endpoint can find what this test's worker writes. */
const EXPORT_STORAGE_DIR = 'var/e2e-exports';

async function connectAs(page: Page, tournamentId: string, actorId: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tournament ID').fill(tournamentId);
  await page.getByLabel('Your user ID').fill(actorId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(new RegExp(`/tournaments/${tournamentId}`));
}

function startWorkerProcess(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['../worker/dist/main.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL, EXPORT_STORAGE_DIR },
    });
    const timer = setTimeout(() => reject(new Error('worker did not start in time')), 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('bagantkd worker started')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[worker] ${chunk.toString()}`));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worker exited early with code ${code}`));
    });
  });
}

/**
 * Phase 6 E2E minimum (ACCEPTANCE §16F): request export -> worker generates -> READY -> download
 * -> validate file, driven entirely through the real UI and a real worker process (not
 * `executeExport` called in-process, unlike the DB-level worker tests — this is the one place the
 * full pg-boss round trip through a separate OS process is actually exercised end to end).
 */
test.describe('export flow', () => {
  let seed: SeededTournament;
  let worker: ChildProcessWithoutNullStreams;

  test.beforeAll(async () => {
    seed = await seedTournament(DATABASE_URL, lockableRuleSet(baseRuleSet));
    worker = await startWorkerProcess();
  });

  test.afterAll(async () => {
    worker.kill();
    await seed.close();
  });

  test('request a PREVIEW tournament draw book, wait for it to become ready, and download it', async ({
    page,
  }) => {
    await connectAs(page, seed.tournament, seed.officer);

    const panel = page.locator('.panel', { hasText: 'Ekspor' }).first();
    await expect(panel.getByRole('button', { name: 'Buat Ekspor' })).toBeVisible();
    await panel.getByRole('button', { name: 'Buat Ekspor' }).click();

    await expect(panel.getByText('Siap')).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Unduh' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path as string);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
