import { test, expect } from '@playwright/test';

test.describe('Tab Restructure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('');
    await page.waitForSelector('.tab-btn');
  });

  test('renders 4 main tabs', async ({ page }) => {
    const tabs = page.locator('.tab-btn');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toContainText('每日詳情');
    await expect(tabs.nth(1)).toContainText('趨勢');
    await expect(tabs.nth(2)).toContainText('週報');
    await expect(tabs.nth(3)).toContainText('成員');
  });

  test('tab switching works', async ({ page }) => {
    // Click 趨勢
    await page.locator('.tab-btn', { hasText: '趨勢' }).click();
    await expect(page.locator('text=每日工時趨勢')).toBeVisible();

    // Click 週報
    await page.locator('.tab-btn', { hasText: '週報' }).click();
    await expect(page.locator('text=日均工時分佈')).toBeVisible();

    // Click back to 每日詳情
    await page.locator('.tab-btn', { hasText: '每日詳情' }).click();
    await expect(page.locator('text=個人工時')).toBeVisible();
  });

  test('sub-view pills visible on detail tab', async ({ page }) => {
    // 工時 pill should always be visible
    await expect(page.getByText('📊 工時')).toBeVisible();
  });

  test('date navigator compact layout', async ({ page }) => {
    // Should show ◀ ▶ arrows
    await expect(page.getByText('◀')).toBeVisible();
    await expect(page.getByText('▶')).toBeVisible();

    // Should show W▾ dropdown button
    await expect(page.getByText(/W\d+\s*▾/)).toBeVisible();
  });

  test('week dropdown shows shortcuts and weeks', async ({ page }) => {
    await page.getByText(/W\d+\s*▾/).click();
    await expect(page.getByText('本週', { exact: true })).toBeVisible();
    await expect(page.getByText('上週', { exact: true })).toBeVisible();
  });
});
