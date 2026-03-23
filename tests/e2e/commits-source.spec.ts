import { test, expect } from '@playwright/test';

test.describe('Commits source icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Commits tab
    await page.click('text=Commits');
  });

  test('shows source icon in commit detail', async ({ page }) => {
    // Find and expand a member's commits
    const memberButton = page.locator('button:has-text("commits")').first();
    if (await memberButton.isVisible()) {
      await memberButton.click();
      // Should see either 🦊 or 🐙 icon in the expanded detail
      const icons = page.locator('td:has-text("🦊"), td:has-text("🐙")');
      expect(await icons.count()).toBeGreaterThan(0);
    }
  });
});
