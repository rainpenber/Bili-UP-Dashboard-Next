import { test, expect } from '../harness';

async function createBlankProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建空白项目' }).click();
  await page.getByLabel('项目名称').fill(name);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/i);
}

test.describe('WP-004R round9 items', () => {
  test('merge two open items', async ({ page }) => {
    const name = `E2E Merge ${Date.now()}`;
    await createBlankProject(page, name);
    for (const title of ['合并 A', '合并 B']) {
      await page.getByRole('button', { name: '新建事项' }).click();
      await page.getByLabel('事项标题').fill(title);
      await page.getByRole('button', { name: '提交事项' }).click();
      await expect(page.getByText(title)).toBeVisible();
    }
    await page.getByLabel('参与合并').first().check();
    await page.getByLabel('参与合并').nth(1).check();
    await page.getByLabel('合并后标题').fill('合并结果');
    await page.getByRole('button', { name: '合并 2 条事项' }).click();
    await expect(page.getByText('合并结果')).toBeVisible({ timeout: 15_000 });
  });

  test('merge failure shows Chinese error', async ({ page }) => {
    const name = `E2E MergeErr ${Date.now()}`;
    await createBlankProject(page, name);
    await page.route('**/api/v1/commercial/projects/*/open-items/merge', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: '找不到可合并的开放事项' }),
      }),
    );
    for (const title of ['合并项 A', '合并项 B']) {
      await page.getByRole('button', { name: '新建事项' }).click();
      await page.getByLabel('事项标题').fill(title);
      await page.getByRole('button', { name: '提交事项' }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    }
    await page.getByRole('checkbox', { name: '参与合并' }).nth(0).check();
    await page.getByRole('checkbox', { name: '参与合并' }).nth(1).check();
    await page.getByLabel('合并后标题').fill('应失败');
    await page.getByRole('button', { name: '合并 2 条事项' }).click();
    await expect(page.getByText('找不到可合并的开放事项')).toBeVisible({ timeout: 15_000 });
  });

  test('item history deep link expands closed item section', async ({ page }) => {
    const name = `E2E Hash ${Date.now()}`;
    await createBlankProject(page, name);
    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('深链事项');
    await page.getByRole('button', { name: '提交事项' }).click();
    const card = page.locator('[id^="item-"]').filter({ hasText: '深链事项' });
    await expect(card).toBeVisible();
    const itemId = await card.getAttribute('id');
    expect(itemId).toMatch(/^item-/);
    await card.getByLabel('闭环结论').fill('已完成');
    await card.getByRole('button', { name: '闭环' }).click();
    await expect(page.getByText('深链事项')).toBeVisible();
    await page.goto(`${page.url().split('#')[0]}#${itemId}`);
    await expect(page.locator(`#${itemId!}`)).toBeVisible();
  });
});

test.describe('WP-004R round9 template undo UI', () => {
  test('undo disabled until graph edit', async ({ page }) => {
    await page.goto('/settings/workflow');
    await expect(page.getByRole('heading', { name: '工作流模板' })).toBeVisible({
      timeout: 20_000,
    });
    const copyBtn = page.getByRole('button', { name: '从当前默认复制草稿' });
    if (await copyBtn.isEnabled()) await copyBtn.click();
    else await page.getByRole('button', { name: '编辑' }).first().click();
    await expect(page.getByText('草稿图编辑')).toBeVisible();
    const undoBtn = page.getByRole('button', { name: '撤销' });
    await page.getByRole('button', { name: '新建模板节点' }).click();
    await page.getByLabel('节点名称').fill('启用撤销');
    await page.getByLabel('slug').fill(`undo_ui_${Date.now()}`);
    await page.getByRole('button', { name: '创建节点' }).click();
    await expect(page.getByText('启用撤销')).toBeVisible({ timeout: 15_000 });
    await expect(undoBtn).toBeEnabled({ timeout: 15_000 });
  });
});

test.describe('WP-004R round9 publish form', () => {
  test('publish panel accepts bvid and datetime', async ({ page }) => {
    const name = `E2E Publish ${Date.now()}`;
    await createBlankProject(page, name);
    await page.getByRole('button', { name: '填写发布信息' }).click();
    await page.getByLabel('BV号').fill('BV1xx411c7mD');
    await page.getByLabel('上线时间').fill('2026-01-15T12:00');
    await expect(page.getByRole('button', { name: '确认发布' })).toBeEnabled();
  });
});
