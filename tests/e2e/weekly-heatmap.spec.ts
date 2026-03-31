import { test, expect } from '@playwright/test';

test.describe('WeeklyView heatmap', () => {
  test('weekly tab shows heatmap', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab-btn', { hasText: '週報' }).click();
    await expect(page.locator('text=一致性總覽（全期間）')).toBeVisible();
  });

  test('weekly table has Commits columns', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab-btn', { hasText: '週報' }).click();
    await expect(page.locator('th:has-text("Commits")').first()).toBeVisible();
  });

  test('clicking heatmap date switches to Commits sub-view', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab-btn', { hasText: '週報' }).click();
    await expect(page.locator('text=一致性總覽（全期間）')).toBeVisible();

    // The heatmap table has date headers (e.g. "3/10") that are clickable
    // Find a th with a date pattern inside the heatmap section
    const heatmapTable = page.locator('text=一致性總覽（全期間）').locator('..').locator('table');
    const dateTh = heatmapTable.locator('th').filter({ hasText: /^\d{1,2}\/\d{1,2}$/ }).first();
    if (await dateTh.isVisible()) {
      await dateTh.click();
      // Should navigate to 每日詳情 tab with Commits sub-view showing scatter chart
      await expect(page.locator('text=工時 × Commits')).toBeVisible();
    }
  });
});
