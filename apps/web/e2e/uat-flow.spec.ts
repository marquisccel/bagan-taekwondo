import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { kyorugiSemiCsv } from '@bagantkd/db/testing/seed-revision';
import { expect, test, type Page } from '@playwright/test';

import { baseRuleSet, lockableRuleSet, seedIntakeOnly, type SeededIntake } from './seed';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';
const EXPORT_STORAGE_DIR = 'var/e2e-exports';

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

const athlete = (name: string, heightCm: number, contingent: string) => ({
  name,
  contingent,
  heightCm,
  weightKg: 44,
  belt: 'GEUP 9 - KUNING',
});

/** Switches the dev identity of the browser (the app has no login; see lib/dev-auth.tsx). */
async function actAs(page: Page, userId: string): Promise<void> {
  await page.evaluate((id) => localStorage.setItem('bagantkd.dev.actorId', id), userId);
  await page.reload();
}

/**
 * Pre-UAT end-to-end path on real PostgreSQL + a real worker process, driven only through the UI:
 * tournament list → participants → validation → create draw → category → pool/bracket → MoveEntry
 * (quality feedback, reason) → SwapEntries (quality feedback) → review → approve → lock → publish →
 * amend → publish the replacement → parent SUPERSEDED → audit history → compact semi-prestasi PDF.
 */
test.describe('UAT flow: semi-prestasi', () => {
  let seed: SeededIntake;
  let worker: ChildProcessWithoutNullStreams;

  test.beforeAll(async () => {
    seed = await seedIntakeOnly(
      DATABASE_URL,
      lockableRuleSet(baseRuleSet),
      kyorugiSemiCsv([
        athlete('Pendek 1', 150, 'Kota A'),
        athlete('Pendek 2', 151, 'Kota B'),
        athlete('Pendek 3', 152, 'Kota A'),
        athlete('Pendek 4', 153, 'Kota C'),
        athlete('Tinggi 1', 170, 'Kota A'),
        athlete('Tinggi 2', 171, 'Kota B'),
        athlete('Tinggi 3', 172, 'Kota C'),
      ]),
    );
    worker = await startWorkerProcess();
  });

  test.afterAll(async () => {
    worker.kill();
    await seed.close();
  });

  test('from the tournament list to a published amendment and the compact PDF', async ({ page }) => {
    test.setTimeout(300_000);

    // 1. open /tournaments, choose the tournament
    await page.goto('/');
    await page.getByLabel('Your user ID').fill(seed.officer);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page).toHaveURL(/\/tournaments$/);
    await expect(page.getByRole('heading', { name: 'Turnamen' })).toBeVisible();
    await expect(page.getByTestId('tournament-row')).toHaveCount(1);
    await page.getByRole('link', { name: /^Buka / }).click();
    await expect(page).toHaveURL(new RegExp(`/tournaments/${seed.tournament}$`));

    // 2. inspect the imported participants + their validation state (no NIK anywhere)
    await page.getByRole('link', { name: 'Lihat peserta' }).click();
    await expect(page).toHaveURL(/\/peserta$/);
    await expect(page.getByTestId('entry-row')).toHaveCount(7);
    await page.getByLabel('Cari peserta').fill('Pendek 1');
    await page.getByRole('button', { name: 'Terapkan' }).click();
    await expect(page.getByTestId('entry-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Atur ulang' }).click();
    await page.getByLabel('Cari kontingen').fill('Kota C');
    await page.getByRole('button', { name: 'Terapkan' }).click();
    await expect(page.getByTestId('entry-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Atur ulang' }).click();
    await expect(page.getByTestId('entry-row')).toHaveCount(7);
    // the validation state of the import: expand the first entry's warning (Indonesian text + code)
    await page.getByText('1 peringatan').first().click();
    await expect(page.getByText('Kelas berat tidak sesuai berat badan').first()).toBeVisible();
    const peserta = await page.locator('main').innerText();
    expect(peserta).not.toMatch(/\b\d{16}\b/);
    expect(peserta).toContain('WEIGHT_CLASS_MISMATCH');

    // 3. create the draw from the UI; the real backend status is shown
    await page.goto(`/tournaments/${seed.tournament}/drawing`);
    await expect(page.getByTestId('preflight-eligible')).toHaveText('7');
    await expect(page.getByTestId('preflight-blocked')).toHaveText('0');
    await page.getByRole('button', { name: 'Buat Drawing' }).click();
    await page.getByRole('button', { name: 'Konfirmasi dan jalankan' }).click();
    await expect(page.getByTestId('draw-run-status-badge')).toContainText(/Aman|SAFE/i, { timeout: 90_000 });
    await page.getByRole('link', { name: 'Buka ruang kerja drawing' }).click();

    // 4. open the category, inspect pool + bracket
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
    await page.locator('tbody tr').filter({ hasText: 'KYORUGI_SEMI_PRESTASI' }).first().click();
    await expect(page.getByText('Brackets')).toBeVisible();
    const pools = page.locator('.pool-card, [aria-label^="Pool"]');
    await expect(pools.first()).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body).not.toMatch(/\b\d{16}\b/);

    // 5. MoveEntry into the tall pool: quality drops -> the server asks for a reason -> applied + feedback
    await page.getByRole('button', { name: 'Move…' }).first().click();
    const moveDialog = page.getByRole('dialog');
    await expect(moveDialog).toBeVisible();
    await moveDialog
      .getByRole('button')
      .filter({ hasNotText: /Cancel|\(current\)/ })
      .first()
      .click();
    const reasonDialog = page.getByRole('dialog', { name: 'Alasan perubahan' });
    await expect(reasonDialog).toBeVisible();
    await expect(reasonDialog).toContainText('selisih tinggi badan');
    await reasonDialog.getByLabel('Alasan').fill('Komplain K-7: pemindahan atas keputusan panitia');
    await reasonDialog.getByRole('button', { name: 'Terapkan' }).click();
    const feedback = page.getByTestId('command-feedback');
    await expect(feedback).toHaveAttribute('data-level', 'YELLOW');
    await expect(feedback).toContainText('Kualitas pengelompokan menurun.');
    await feedback.getByRole('button', { name: 'Tutup' }).click();

    // 6. SwapEntries: feedback again (server verdict)
    await page.getByRole('button', { name: 'Swap…' }).first().click();
    await page.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
    const swapFeedback = page.getByTestId('command-feedback');
    const reason2 = page.getByRole('dialog', { name: 'Alasan perubahan' });
    if (await reason2.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await reason2.getByLabel('Alasan').fill('Pertukaran atas keputusan panitia');
      await reason2.getByRole('button', { name: 'Terapkan' }).click();
    }
    await expect(swapFeedback).toBeVisible();

    // 7. review → approve → lock → publish → amend
    await page.goto(`/tournaments/${seed.tournament}/categories`);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await actAs(page, seed.td);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Lock' })).toBeEnabled();
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByLabel('Amendment reason').fill('Amandemen UAT: koreksi setelah komplain');
    await page.getByRole('button', { name: 'Amend', exact: true }).click();

    // 8. the amendment is a new DRAFT revision; drive it to PUBLISHED (replacement)
    await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible({ timeout: 20_000 });
    await actAs(page, seed.officer);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await actAs(page, seed.td);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByLabel('Amendment reason')).toBeVisible();

    // 9. the parent is SUPERSEDED, the replacement is the current PUBLISHED revision
    const revisions = await seed.db.query<{ revision_no: number; lifecycle: string }>(
      `select revision_no, lifecycle from draw_revision where tournament_id = $1 order by revision_no`,
      [seed.tournament],
    );
    expect(revisions).toEqual([
      { revision_no: 1, lifecycle: 'SUPERSEDED' },
      { revision_no: 2, lifecycle: 'PUBLISHED' },
    ]);

    // 10. audit history shows the quality verdicts and the supersede
    await page.goto(`/tournaments/${seed.tournament}/audit`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const actions = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(actions).toEqual(
      expect.arrayContaining([
        'MOVE_ENTRY',
        'SWAP_ENTRIES',
        'LIFECYCLE_PUBLISH',
        'LIFECYCLE_AMEND',
        'LIFECYCLE_SUPERSEDE',
      ]),
    );
    const details = (await page.getByTestId('audit-detail').allInnerTexts()).join('\n');
    expect(details).toContain('Kualitas menurun');
    expect(details).toContain('Digantikan oleh revisi');

    // 11. compact semi-prestasi PDF from the tournament overview (OFFICIAL: the revision is published)
    await page.goto(`/tournaments/${seed.tournament}`);
    const panel = page.locator('.panel', { hasText: 'Ekspor' }).first();
    await panel.getByLabel('Jenis ekspor').selectOption('SEMI_PRESTASI_COMPACT_DRAW_SHEET');
    await panel.getByLabel('Status resmi').selectOption('OFFICIAL');
    await panel.getByRole('button', { name: 'Buat Ekspor' }).click();
    await expect(panel.getByText('Siap')).toBeVisible({ timeout: 60_000 });
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Unduh' }).click();
    const download = await downloadPromise;
    const bytes = readFileSync((await download.path()) as string);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
