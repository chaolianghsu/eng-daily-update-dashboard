import { test, expect } from '@playwright/test';

test('dashboard loads and shows title', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('h1')).toContainText('工程部 Daily Update');
});
