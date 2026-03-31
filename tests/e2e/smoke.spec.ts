import { test, expect } from '@playwright/test';

test('dashboard loads and shows title', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('h1')).toContainText('工程部 Daily Update');
});

test('date navigator arrows visible', async ({ page }) => {
  await page.goto('');
  await page.waitForSelector('.tab-btn');

  await expect(page.getByText('◀')).toBeVisible();
  await expect(page.getByText('▶')).toBeVisible();
});

test('week dropdown opens on W▾ click', async ({ page }) => {
  await page.goto('');
  await page.waitForSelector('.tab-btn');

  await page.getByText(/W\d+\s*▾/).click();

  // 本週 and 上週 should be visible inside dropdown
  await expect(page.getByText('本週', { exact: true })).toBeVisible();
  await expect(page.getByText('上週', { exact: true })).toBeVisible();
});
