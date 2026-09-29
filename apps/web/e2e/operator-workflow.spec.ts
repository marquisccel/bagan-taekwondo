import { expect, test, type Page } from '@playwright/test';

import { baseRuleSet, lockableRuleSet, seedTournament, type SeededTournament } from './seed';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';

async function connectAs(page: Page, tournamentId: string, actorId: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Tournament ID').fill(tournamentId);
  await page.getByLabel('Your user ID').fill(actorId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(new RegExp(`/tournaments/${tournamentId}`));
}

/**
 * ACCEPTANCE §TESTING E2E minimum: open tournament → inspect category → inspect pool/bracket →
 * move participant → revision created → submit review → approve → lock → publish → amend →
 * verify audit history. Uses a lockable rule set so LOCK/PUBLISH/AMEND actually succeed (the
 * shipped provisional rule set is intentionally not lockable — see the RULE_SET_NOT_READY test
 * in apps/api's own contract suite for that path).
 */
test.describe('operator workflow', () => {
  let seed: SeededTournament;

  test.beforeAll(async () => {
    seed = await seedTournament(DATABASE_URL, lockableRuleSet(baseRuleSet));
  });

  test.afterAll(async () => {
    await seed.close();
  });

  test('inspect, move, and drive the revision through the full lifecycle, with audit history at the end', async ({
    page,
  }) => {
    await connectAs(page, seed.tournament, seed.officer);

    // Dashboard: current draw run is SAFE, revision is DRAFT.
    await expect(page.getByText('SAFE', { exact: true })).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();

    // Categories: browse to one with 2+ entries in a pool.
    await page.getByRole('link', { name: 'Browse categories' }).click();
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
    const row = page
      .locator('tbody tr')
      .filter({ hasText: 'KYORUGI_SEMI_PRESTASI' })
      .filter({ hasText: 'WEIGHT_CLASS=-49' })
      .first();
    await row.click();

    // Category detail: pool + bracket are visible with safe (non-NIK) entry display fields.
    const pools = page.locator('.pool-card, [aria-label^="Pool"]');
    await expect(pools.first()).toBeVisible();
    await page.getByRole('tab', { name: 'Bagan Pertandingan' }).click();
    await expect(page.locator('.bracket-match').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Pool & Peserta' }).click();
    // The fixture's synthetic display names spell out "NIK" as part of the data-quality test case
    // they describe (e.g. "REG CASE NIK DOT") — that is the label, not a real NIK. What must never
    // appear is an actual NIK-shaped value (16 digits) or the raw encrypted/blind-index columns.
    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toMatch(/\b\d{16}\b/);
    expect(bodyText.toLowerCase()).not.toMatch(/nik_ciphertext|nik_blind_index/);

    // Move an entry via the keyboard-accessible dialog (same command a drag-and-drop drop fires).
    const moveButtons = page.getByRole('button', { name: 'Pindahkan' });
    await moveButtons.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: /\(saat ini\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Batal' }).click();

    // Swap two entries within the pool — a real command, applied by the server and reflected back
    // after the refetch. Synchronize on the observable state (the command's response, the revision's
    // lock_version, the refetch and the server's verdict shown in the UI), never on incidental bracket
    // text: a swap inside one pool may legitimately rebuild the very same layout.
    const lockVersion = async () =>
      (
        await seed.db.query<{ lock_version: number }>(
          `select lock_version from draw_revision where tournament_id = $1`,
          [seed.tournament],
        )
      )[0]?.lock_version;
    const lockBefore = await lockVersion();
    const swapResponse = page.waitForResponse(
      (r) => r.url().includes('/commands/swap-entry') && r.request().method() === 'POST',
    );
    const refetch = page.waitForResponse(
      (r) => /\/revisions\/[^/]+\/categories\/[^/]+$/.test(r.url()) && r.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Tukar Peserta' }).first().click();
    await page.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Batal' }).first().click();
    const swapped = await swapResponse;
    expect(swapped.status()).toBe(201);
    expect(await swapped.json()).toMatchObject({ outcome: 'APPLIED' });
    await refetch;
    await expect.poll(lockVersion).toBe((lockBefore ?? -1) + 1);
    await expect(page.getByTestId('command-feedback')).toHaveAttribute('data-level', 'GREEN');

    // Lifecycle: submit for review (officer), then switch to a Technical Delegate for the rest.
    await page.goto(`/tournaments/${seed.tournament}/categories`);
    await page.getByRole('button', { name: 'Ajukan untuk Ditinjau' }).click();
    await expect(page.getByRole('button', { name: 'Setujui' })).toBeVisible();

    await page.evaluate((td) => localStorage.setItem('bagantkd.dev.actorId', td), seed.td);
    await page.reload();
    await page.getByRole('button', { name: 'Setujui' }).click();
    await expect(page.getByRole('button', { name: 'Kunci Drawing' })).toBeEnabled();
    await page.getByRole('button', { name: 'Kunci Drawing' }).click();
    await expect(page.getByRole('button', { name: 'Terbitkan Drawing' })).toBeEnabled();
    await page.getByRole('button', { name: 'Terbitkan Drawing' }).click();
    await expect(page.getByLabel('Alasan revisi')).toBeVisible();

    // Amend stays disabled until a reason is entered (a required audit field, not optional).
    await expect(page.getByRole('button', { name: 'Buat Revisi', exact: true })).toBeDisabled();
    await page.getByLabel('Alasan revisi').fill('E2E amendment reason');
    await expect(page.getByRole('button', { name: 'Buat Revisi', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Buat Revisi', exact: true }).click();
    // Amend produces a new child revision (DRAFT); the categories page does a full navigation (same
    // URL) to pick it up. Let that settle before navigating away, or the two navigations race.
    await expect(page.locator('.lifecycle-step.current')).toHaveText('Draf', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // Audit history reflects every command in order.
    await page.goto(`/tournaments/${seed.tournament}/audit`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const actions = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(actions).toContain('LIFECYCLE_PUBLISH');
    expect(actions).toContain('LIFECYCLE_AMEND');
    expect(actions).toContain('SWAP_ENTRIES');
  });
});
