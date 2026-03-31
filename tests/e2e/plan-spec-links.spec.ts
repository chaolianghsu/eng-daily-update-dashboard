import { test, expect } from '@playwright/test';

test.describe('Plan/Spec file links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('');
    await page.waitForSelector('.tab-btn');
    // Navigate to Plan Tracking sub-view via 📋 規劃 pill (only visible when plan data exists)
    const planPill = page.getByText('📋 規劃');
    if (await planPill.isVisible()) {
      await planPill.click();
    }
  });

  test('spec file names are clickable links with blob URLs', async ({ page }) => {
    // Look for file name links (they have the full file path in title attribute)
    const fileLink = page.locator('a[title*="/"]').first();
    if (await fileLink.isVisible()) {
      const href = await fileLink.getAttribute('href');
      // Blob URLs for both GitLab and GitHub
      // GitLab: /-/blob/[sha]/path or /blob/[sha]/path
      // GitHub: /blob/[sha]/path
      expect(href).toMatch(/\/-\/blob\/[a-f0-9]+\/|\/blob\/[a-f0-9]+\//);
      expect(await fileLink.getAttribute('target')).toBe('_blank');
    }
  });

  test('diff icon links point to commit URL', async ({ page }) => {
    // Look for diff icon link (↔ character)
    const diffLink = page.locator('a:has-text("↔")').first();
    if (await diffLink.isVisible()) {
      const href = await diffLink.getAttribute('href');
      // Commit URLs for both GitLab and GitHub
      // GitLab: /-/commit/[sha] or /commit/[sha]
      // GitHub: /commit/[sha]
      expect(href).toMatch(/\/-\/commit\/[a-f0-9]+|\/commit\/[a-f0-9]+/);
      expect(await diffLink.getAttribute('title')).toBe('查看 diff');
      expect(await diffLink.getAttribute('target')).toBe('_blank');
    }
  });

  test('file links have full path in title attribute', async ({ page }) => {
    // Verify that file name links preserve full path in title
    const fileLinks = page.locator('a[title*="docs/"], a[title*="specs/"], a[title*="plans/"], a[title*="design/"]');
    const count = await fileLinks.count();
    if (count > 0) {
      const firstLink = fileLinks.first();
      const title = await firstLink.getAttribute('title');
      // Should contain path separators indicating full path
      expect(title).toMatch(/\//);
    }
  });
});
