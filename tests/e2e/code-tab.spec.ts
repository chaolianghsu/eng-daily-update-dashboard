import { test, expect } from '@playwright/test';

test('代號 tab is reachable and shows empty-state on legacy data', async ({ page }) => {
  await page.goto('');
  await page.waitForSelector('.tab-btn');

  await page.getByRole('button', { name: /代號/ }).click();

  // Legacy raw_data has no items[] yet, so CodeView shows its empty-state hint.
  await expect(page.getByText(/尚無 \[CODE\] 標記/)).toBeVisible();
});
