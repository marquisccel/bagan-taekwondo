import { expect, test } from '@playwright/test';

import { seedTournament, type SeededTournament } from './seed';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';

/**
 * ACCEPTANCE §TESTING: two browser contexts with stale revisions — the first command succeeds,
 * the second gets REVISION_CONFLICT, and the UI never overwrites the first operator's change.
 */
test.describe('two-operator concurrency', () => {
  let seed: SeededTournament;

  test.beforeAll(async () => {
    seed = await seedTournament(DATABASE_URL);
  });

  test.afterAll(async () => {
    await seed.close();
  });

  test('operator B sees a conflict banner, not a silent overwrite, when operator A moves first', async ({
    browser,
  }) => {
    const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);

    for (const page of [pageA, pageB]) {
      await page.goto('/');
      await page.getByLabel('Tournament ID').fill(seed.tournament);
      await page.getByLabel('Your user ID').fill(seed.officer);
      await page.getByRole('button', { name: 'Connect' }).click();
    }

    const categoryPath = `/tournaments/${seed.tournament}/categories`;
    await pageA.goto(categoryPath);
    await pageB.goto(categoryPath);
    const rowA = pageA
      .locator('tbody tr')
      .filter({ hasText: 'KYORUGI_SEMI_PRESTASI' })
      .filter({ hasText: 'WEIGHT_CLASS=-49' })
      .first();
    const rowB = pageB
      .locator('tbody tr')
      .filter({ hasText: 'KYORUGI_SEMI_PRESTASI' })
      .filter({ hasText: 'WEIGHT_CLASS=-49' })
      .first();
    await rowA.click();
    await rowB.click();

    // Both pages loaded the same revision (lock_version 0). Operator A swaps first and succeeds.
    await pageA.getByRole('button', { name: 'Tukar Peserta' }).first().click();
    await pageA.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Batal' }).first().click();
    await expect(pageA.locator('main').getByRole('alert')).toHaveCount(0);

    // Operator B, still holding the stale revision snapshot in the page, submits a swap against
    // the same (now stale) expectedLockVersion. It must be rejected, not silently merged.
    await pageB.getByRole('button', { name: 'Tukar Peserta' }).first().click();
    await pageB.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Batal' }).first().click();
    await expect(pageB.locator('main').getByRole('alert')).toContainText(/diperbarui oleh pengguna lain/i);

    // Reloading operator B's view picks up the canonical (operator A's) state.
    await pageB.getByRole('button', { name: 'Muat Ulang' }).click();
    await expect(pageB.locator('main').getByRole('alert')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });
});
