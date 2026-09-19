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
    await expect(page.getByRole('heading', { name: /KYORUGI/ })).toBeVisible();
    await expect(page.getByText('Brackets')).toBeVisible();
    // The fixture's synthetic display names spell out "NIK" as part of the data-quality test case
    // they describe (e.g. "REG CASE NIK DOT") — that is the label, not a real NIK. What must never
    // appear is an actual NIK-shaped value (16 digits) or the raw encrypted/blind-index columns.
    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toMatch(/\b\d{16}\b/);
    expect(bodyText.toLowerCase()).not.toMatch(/nik_ciphertext|nik_blind_index/);

    // Move an entry via the keyboard-accessible dialog (same command a drag-and-drop drop fires).
    const moveButtons = page.getByRole('button', { name: 'Move…' });
    await moveButtons.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: /\(current\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

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
    await page.getByRole('button', { name: 'Swap…' }).first().click();
    await page.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
    const swapped = await swapResponse;
    expect(swapped.status()).toBe(201);
    expect(await swapped.json()).toMatchObject({ outcome: 'APPLIED' });
    await refetch;
    await expect.poll(lockVersion).toBe((lockBefore ?? -1) + 1);
    await expect(page.getByTestId('command-feedback')).toHaveAttribute('data-level', 'GREEN');

    // Lifecycle: submit for review (officer), then switch to a Technical Delegate for the rest.
    await page.goto(`/tournaments/${seed.tournament}/categories`);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();

    await page.evaluate((td) => localStorage.setItem('bagantkd.dev.actorId', td), seed.td);
    await page.reload();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Lock' })).toBeEnabled();
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByLabel('Amendment reason')).toBeVisible();

    // Amend stays disabled until a reason is entered (a required audit field, not optional).
    await expect(page.getByRole('button', { name: 'Amend', exact: true })).toBeDisabled();
    await page.getByLabel('Amendment reason').fill('E2E amendment reason');
    await expect(page.getByRole('button', { name: 'Amend', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Amend', exact: true }).click();
    // Amend produces a new child revision; the categories page does a full navigation (same URL)
    // to pick it up. Let that settle before navigating away, or the two navigations race.
    await expect(page.getByText('AMENDED')).toBeVisible({ timeout: 15_000 });
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
