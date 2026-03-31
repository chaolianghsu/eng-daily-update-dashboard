import { test, expect } from '@playwright/test';

test.describe('Commits source icons', () => {
  test('shows source icon in commit detail', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.tab-btn');

    // Navigate to Commits sub-view via pill (only shown when commit data exists)
    const commitsPill = page.getByText('🔀 Commits');
    if (!await commitsPill.isVisible()) {
      // No commit data available — skip
      return;
    }
    await commitsPill.click();
    await expect(page.locator('text=Commit 明細')).toBeVisible();

    // Find the Commit 明細 card panel by its class and title text
    const detailCard = page.locator('.card-panel', { hasText: /Commit 明細/ }).last();
    const memberButton = detailCard.locator('button', { hasText: /\d+ commits/ }).first();
    if (await memberButton.isVisible()) {
      await memberButton.scrollIntoViewIfNeeded();
      await memberButton.click();
      // After expanding, the table appears inside the card
      const expandedTable = detailCard.locator('table').first();
      const firstRow = expandedTable.locator('tbody tr').first();
      await expect(firstRow).toBeVisible({ timeout: 5000 });
      // First td should contain either 🦊 (GitLab) or 🐙 (GitHub) source icon
      const firstCell = firstRow.locator('td').first();
      const cellText = await firstCell.textContent();
      expect(cellText).toMatch(/🦊|🐙/);
    }
  });
});
