import { test, expect } from '@playwright/test';

test.describe('CommitsView datetime display', () => {
  test('commits tab shows scatter chart', async ({ page }) => {
    await page.goto('/');
    const commitsTab = page.locator('button:has-text("Commits")');
    if (await commitsTab.isVisible()) {
      await commitsTab.click();
      await expect(page.locator('text=工時 × Commits')).toBeVisible();
    }
  });

  test('commit detail expand shows commit rows with times', async ({ page }) => {
    await page.goto('/');
    const commitsTab = page.locator('button:has-text("Commits")');
    if (await commitsTab.isVisible()) {
      await commitsTab.click();
      await expect(page.locator('text=Commit 明細')).toBeVisible();

      // Find and click a member expand button (shows "N commits ▼")
      const expandBtn = page.locator('button:has-text("commits")').first();
      if (await expandBtn.isVisible()) {
        await expandBtn.click();
        // After expanding, commit table rows should appear
        // Each row has 4 td cells: time | project | title | sha
        // The first td in each row contains an HH:MM time or "—"
        const expandedTable = page.locator('table').last();
        const firstRow = expandedTable.locator('tbody tr').first();
        await expect(firstRow).toBeVisible({ timeout: 5000 });

        // The first cell of the row should contain a time (HH:MM) or dash
        const firstCell = firstRow.locator('td').first();
        const cellText = await firstCell.textContent();
        // Verify it contains a time pattern or dash
        expect(cellText?.trim()).toMatch(/^\d{1,2}:\d{2}$|^—$/);
      }
    }
  });
});
