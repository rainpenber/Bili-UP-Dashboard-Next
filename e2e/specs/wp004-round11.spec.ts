import { test, expect, expectLocatorInViewport } from '../harness';

async function createBlankProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建空白项目' }).click();
  await page.getByLabel('项目名称').fill(name);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/i);
  const m = page.url().match(/\/projects\/([0-9a-f-]+)/i);
  return m![1]!;
}

test.describe('WP-004R round11 deep link viewport', () => {
  test('#item-* scrolls closed item history into viewport', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E R11 ItemVP ${Date.now()}`);
    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('视口历史项');
    await page.getByRole('button', { name: '提交事项' }).click();
    const card = page.locator('[id^="item-"]').filter({ hasText: '视口历史项' });
    const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');
    await card.getByLabel('闭环结论').fill('完成');
    await card.getByRole('button', { name: '闭环' }).click();
    await expect
      .poll(
        async () => {
          const hist = await page.request.get(
            `/api/v1/commercial/projects/${projectId}/open-items/${itemId}/history`,
          );
          if (!hist.ok()) return false;
          const body = (await hist.json()) as { items: { action: string }[] };
          return (
            body.items.some((e) => e.action === 'create') &&
            body.items.some((e) => e.action === 'close')
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.goto(`/projects/${projectId}#item-${itemId}`);
    await expect(page.getByText('创建')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('关闭')).toBeVisible();
    await expectLocatorInViewport(page, `#item-${itemId}`);
  });

  test('#node-* scrolls node panel into viewport', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E R11 NodeVP ${Date.now()}`);
    const wf = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const outline = (
      (await wf.json()) as { nodes: { id: string; slug: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    await page.goto(`/projects/${projectId}#node-${outline!.id}`);
    await expect(page.getByLabel('节点名称')).toBeVisible({ timeout: 15_000 });
    await expectLocatorInViewport(page, `#node-${outline!.id}`);
  });
});

test.describe('WP-004R round11 strict acceptance', () => {
  test('invalid edge connect shows Chinese error in UI', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E R11 EdgeUI ${Date.now()}`);
    await expect(page.getByRole('heading', { name: '工作流图' })).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
    const wf = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const body = (await wf.json()) as {
      nodes: { id: string; slug: string | null; name: string }[];
    };
    const publish = body.nodes.find((n) => n.slug === 'publish')!;
    const inquiry = body.nodes.find((n) => n.slug === 'inquiry')!;
    const sourceHandle = page.locator(
      `.react-flow__node[data-id="${publish.id}"] .react-flow__handle-bottom`,
    );
    const targetHandle = page.locator(
      `.react-flow__node[data-id="${inquiry.id}"] .react-flow__handle-top`,
    );
    await sourceHandle.scrollIntoViewIfNeeded();
    await targetHandle.scrollIntoViewIfNeeded();
    const edgeResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/projects/${projectId}/edges`) && res.request().method() === 'POST',
    );
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    expect(sourceBox && targetBox).toBeTruthy();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    const res = await edgeResponse;
    expect(res.status()).toBe(409);
    const errBody = (await res.json()) as { error?: string };
    expect(errBody.error).toBe('连线会形成环路，已拒绝');
    await expect(page.getByText('连线会形成环路，已拒绝')).toBeVisible({ timeout: 15_000 });
  });

  test('publish via API asserts monitor jobs and single video', async ({ page, request }) => {
    const projectId = await createBlankProject(page, `E2E R11 PubAPI ${Date.now()}`);
    const bvid = `BV11e2e${Date.now()}`;
    const pub = await request.post(`/api/v1/commercial/projects/${projectId}/publish`, {
      data: {
        bvid,
        publishedAt: '2026-03-01T12:00:00.000Z',
        idempotencyKey: `e2e-r11-${projectId}`,
      },
    });
    expect(pub.ok()).toBeTruthy();
    const result = (await pub.json()) as { monitorJobTypes?: string[]; bvid: string };
    expect(result.monitorJobTypes?.sort()).toEqual(['metadata', 'metrics']);
    const pub2 = await request.post(`/api/v1/commercial/projects/${projectId}/publish`, {
      data: {
        bvid: 'BVOTHER',
        publishedAt: '2026-03-01T12:00:00.000Z',
        idempotencyKey: `e2e-r11-dup-${projectId}`,
      },
    });
    expect(pub2.status()).toBe(409);
  });

  test('pin primary block binds item on workflow node', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E R11 Pin ${Date.now()}`);
    const wf0 = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const outline = (
      (await wf0.json()) as { nodes: { id: string; slug: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('主阻塞绑定');
    await page.locator('select').filter({ hasText: '普通' }).selectOption('blocking');
    await page.locator('select:has(option:text("选择阻塞节点"))').selectOption(outline!.id);
    await page.getByRole('button', { name: '提交事项' }).click();
    const card = page.locator('[id^="item-"]').filter({ hasText: '主阻塞绑定' });
    await expect(card).toBeVisible();
    const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');
    await card.getByRole('button', { name: '设为主要阻塞' }).click();
    const wf1 = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const node = (
      (await wf1.json()) as {
        nodes: { id: string; primaryBlockPinnedItemId?: string | null }[];
      }
    ).nodes.find((n) => n.id === outline!.id);
    expect(node?.primaryBlockPinnedItemId).toBe(itemId);
  });
});
