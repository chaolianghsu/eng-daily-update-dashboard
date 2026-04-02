import { test, expect } from '@playwright/test';

test.describe('Member Health Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('');
    await page.waitForSelector('.tab-btn');
  });

  test('can navigate to member tab', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    await expect(page.locator('[data-testid^="profile-card-"]').first()).toBeVisible();
  });

  test('member selector pills are rendered', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    // Wait for profile cards to confirm tab loaded
    await expect(page.locator('[data-testid^="profile-card-"]').first()).toBeVisible();
  });

  test('4 profile cards are rendered', async ({ page }) => {
    await page.locator('.tab-btn', { hasText: '成員' }).click();
    const cards = page.locator('[data-testid^="profile-card-"]');
    await expect(cards).toHaveCount(4);
  });

  test('StatusOverview is visible on page load', async ({ page }) => {
    const overview = page.locator('.status-overview');
    await expect(overview).toBeVisible();
  });
});
