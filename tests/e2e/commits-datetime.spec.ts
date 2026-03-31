import { test, expect } from '@playwright/test';

test.describe('CommitsView datetime display', () => {
  test('commits sub-view shows scatter chart', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tab-btn');
    const commitsPill = page.getByText('🔀 Commits');
    if (await commitsPill.isVisible()) {
      await commitsPill.click();
      await expect(page.locator('text=工時 × Commits')).toBeVisible();
    }
  });

  test('commit detail expand shows commit rows with source icon and time', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tab-btn');
    const commitsPill = page.getByText('🔀 Commits');
    if (await commitsPill.isVisible()) {
      await commitsPill.click();
      await expect(page.locator('text=Commit 明細')).toBeVisible();

      // Find and click a member expand button (shows "N commits ▼")
      const expandBtn = page.locator('button:has-text("commits")').first();
      if (await expandBtn.isVisible()) {
        await expandBtn.click();
        // After expanding, commit table rows should appear
        // Row structure: source icon td | time td | project td | title td | sha td
        const expandedTable = page.locator('table').last();
        const firstRow = expandedTable.locator('tbody tr').first();
        await expect(firstRow).toBeVisible({ timeout: 5000 });

        // The second td in each row contains time (HH:MM) or "—"
        const timeCell = firstRow.locator('td').nth(1);
        const cellText = await timeCell.textContent();
        expect(cellText?.trim()).toMatch(/^\d{1,2}:\d{2}$|^—$/);
      }
    }
  });
});
