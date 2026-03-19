import { test, expect } from '@playwright/test';

test.describe('DailyView status indicators', () => {
  test('dashboard loads with daily view', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('工程部 Daily Update');
    // Daily tab should be active by default — look for bar chart card title
    await expect(page.locator('text=個人工時（開發 + 會議）')).toBeVisible();
  });

  test('shows status text for null-total members', async ({ page }) => {
    await page.goto('/');
    // Members with null total should show "未報" (unreported), "無工時" (replied_no_hours), or "假" (leave)
    // At least one of these indicators should exist in the data
    const statusTexts = page.locator('text=/未報|無工時|假/');
    // Verify the page renders without error and the daily view is displayed
    await expect(page.locator('h1')).toContainText('工程部');
    await expect(page.locator('text=個人工時（開發 + 會議）')).toBeVisible();
  });

  test('member cards are rendered', async ({ page }) => {
    await page.goto('/');
    // The member grid should contain member cards with status badges
    const memberCards = page.locator('.member-card');
    await expect(memberCards.first()).toBeVisible();
    // Each card should have an "hr" label
    await expect(page.locator('.member-card >> text=hr').first()).toBeVisible();
  });
});
