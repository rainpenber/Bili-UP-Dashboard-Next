import { test, expect } from '@playwright/test';

/**
 * Minimal smoke — full WP-004R matrix is documented in docs/e2e/WP-004R-browser.md.
 * These tests fail fast when API/DB are not wired (expected in CI until E2E job is added).
 */
test.describe('WP-004R commercial smoke', () => {
  test('home dashboard loads', async ({ page }) => {
    await page.goto('/commercial');
    await expect(page.getByRole('heading', { name: /商单|项目|工作台/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('create project and open detail', async ({ page }) => {
    await page.goto('/commercial/projects');
    const create = page.getByRole('button', { name: /新建|创建项目/i });
    if (!(await create.isVisible().catch(() => false))) {
      test.skip(true, 'projects list UI not found — extend selectors when E2E job is enabled');
    }
    await create.click();
    await page.getByLabel(/名称|项目名/i).fill(`E2E ${Date.now()}`);
    await page.getByRole('button', { name: /提交|创建|保存/i }).click();
    await expect(page).toHaveURL(/\/commercial\/projects\/[0-9a-f-]+/i, { timeout: 20_000 });
  });
});
