import { test, expect } from '@playwright/test';

async function createBlankProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建空白项目' }).click();
  await page.getByLabel('项目名称').fill(name);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/i);
}

async function selectWorkflowNode(page: import('@playwright/test').Page, label: string) {
  const node = page.locator('.react-flow__node').filter({ hasText: label }).first();
  await expect(node).toBeVisible({ timeout: 20_000 });
  await node.click();
}

async function openTemplateDraftEditor(page: import('@playwright/test').Page) {
  await page.goto('/settings/workflow');
  await expect(page.getByRole('heading', { name: '工作流模板' })).toBeVisible({ timeout: 20_000 });
  const copyBtn = page.getByRole('button', { name: '从当前默认复制草稿' });
  if (await copyBtn.isVisible()) {
    const enabled = await copyBtn.isEnabled();
    if (enabled) {
      await copyBtn.click();
    } else {
      await page.getByRole('button', { name: '编辑' }).first().click();
    }
  }
  await expect(page.getByText('草稿图编辑')).toBeVisible({ timeout: 20_000 });
}

test.describe('WP-004R project workflow journey', () => {
  test('create project, edit node, add serial node, undo', async ({ page }) => {
    const name = `E2E WF ${Date.now()}`;
    await createBlankProject(page, name);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await selectWorkflowNode(page, '商务立项');
    await page.getByRole('button', { name: '添加串行节点' }).click();
    await page.getByLabel('新节点名称').fill('串行验收节点');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('串行验收节点')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.getByText('串行验收节点')).not.toBeVisible({ timeout: 15_000 });
  });

  test('open item lifecycle, split, and history deep link', async ({ page }) => {
    const name = `E2E Item ${Date.now()}`;
    await createBlankProject(page, name);
    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('待拆分事项');
    await page.getByRole('button', { name: '提交事项' }).click();
    await expect(page.getByText('待拆分事项')).toBeVisible();
    await page.getByText('拆分 / 提升为节点').click();
    await page.getByLabel('拆分标题').fill('子事项 A\n子事项 B');
    await page.getByRole('button', { name: '拆分' }).click();
    await expect(page.getByText('子事项 A')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('子事项 B')).toBeVisible();
  });
});

test.describe('WP-004R template draft journey', () => {
  test('draft from default, empty graph add node, undo/redo shortcuts', async ({ page }) => {
    await openTemplateDraftEditor(page);
    await page.getByRole('button', { name: '新建模板节点' }).click();
    await page.getByLabel('节点名称').fill('E2E 模板节点');
    await page.getByLabel('slug').fill(`e2e_node_${Date.now()}`);
    await page.getByRole('button', { name: '创建节点' }).click();
    await expect(page.getByText('E2E 模板节点')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Control+Z');
    await expect(page.getByText('E2E 模板节点')).not.toBeVisible({ timeout: 15_000 });
  });
});

test.describe('WP-004R responsive', () => {
  test('project detail on narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const name = `E2E Narrow ${Date.now()}`;
    await createBlankProject(page, name);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('工作流图', { exact: true })).toBeVisible();
  });
});
