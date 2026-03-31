import { test, expect } from '@playwright/test';

test('dashboard loads and shows title', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('h1')).toContainText('工程部 Daily Update');
});

test('week navigator arrows and pills visible', async ({ page }) => {
  await page.goto('');
  await page.waitForSelector('.date-btn');

  await expect(page.getByText('◀')).toBeVisible();
  await expect(page.getByText('▶')).toBeVisible();
  await expect(page.getByText('本週', { exact: true })).toBeVisible();
  await expect(page.getByText('上週', { exact: true })).toBeVisible();
});

test('week navigator dropdown opens on label click', async ({ page }) => {
  await page.goto('');
  await page.waitForSelector('.date-btn');

  await page.getByText(/▾/).click();

  const options = page.locator('[style*="position: absolute"]').locator('button');
  await expect(options.first()).toBeVisible();
});
