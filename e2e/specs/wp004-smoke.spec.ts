import { test, expect } from '@playwright/test';

test.describe('WP-004R commercial E2E', () => {
  test('today dashboard loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '首页' })).toBeVisible({ timeout: 20_000 });
  });

  test('create project and open detail', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: '新建空白项目' }).click();
    const name = `E2E ${Date.now()}`;
    await page.getByLabel('项目名称').fill(name);
    await page.getByRole('button', { name: '创建' }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: name }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/i);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('workflow settings page loads', async ({ page }) => {
    await page.goto('/settings/workflow');
    await expect(page.getByRole('heading', { name: '工作流模板' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('narrow viewport still renders project list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: '项目列表' })).toBeVisible();
  });
});
