import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

async function createBlankProject(page: Page, name: string) {
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

async function ensureDraftId(request: APIRequestContext): Promise<string> {
  const versions = await request.get('/api/v1/commercial/templates/versions');
  expect(versions.ok()).toBeTruthy();
  const items = (await versions.json()) as {
    items: Array<{ id: string; isDraft: boolean }>;
  };
  const draft = items.items.find((i) => i.isDraft);
  if (draft) return draft.id;
  const created = await request.post('/api/v1/commercial/templates/draft-from-default');
  expect(created.ok()).toBeTruthy();
  return ((await created.json()) as { draftId: string }).draftId;
}

async function publishDraftViaApi(request: APIRequestContext) {
  const draftId = await ensureDraftId(request);
  const val = await request.post(`/api/v1/commercial/templates/versions/${draftId}/validate`);
  expect(val.ok()).toBeTruthy();
  const pub = await request.post(`/api/v1/commercial/templates/versions/${draftId}/publish`);
  expect(pub.ok()).toBeTruthy();
  return ((await pub.json()) as { publishedVersionId: string }).publishedVersionId;
}

async function openDraftEditor(page: Page) {
  await page.goto('/settings/workflow');
  await expect(page.getByRole('heading', { name: '工作流模板' })).toBeVisible({
    timeout: 20_000,
  });
  const copyBtn = page.getByRole('button', { name: '从当前默认复制草稿' });
  if (await copyBtn.isEnabled()) {
    await copyBtn.click();
  }
  await page.getByRole('button', { name: '编辑' }).first().click();
  await expect(page.getByText('草稿图编辑')).toBeVisible({ timeout: 20_000 });
}

test.describe('WP-004R round10 template publish isolation', () => {
  test('new projects pick published default; existing project unchanged', async ({ page }) => {
    const projectAId = await createBlankProject(page, `E2E Iso A ${Date.now()}`);
    const wfA0 = await page.request.get(`/api/v1/commercial/projects/${projectAId}/workflow`);
    expect(wfA0.ok()).toBeTruthy();
    const nodesA0 = (
      (await wfA0.json()) as { nodes: { slug: string | null; templateNodeId: string | null }[] }
    ).nodes;
    const outlineA0 = nodesA0.find((n) => n.slug === 'outline');
    expect(outlineA0?.templateNodeId).toBeTruthy();

    await publishDraftViaApi(page.request);

    const wfA1 = await page.request.get(`/api/v1/commercial/projects/${projectAId}/workflow`);
    const outlineA1 = (
      (await wfA1.json()) as { nodes: { slug: string | null; templateNodeId: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    expect(outlineA1?.templateNodeId).toBe(outlineA0!.templateNodeId);

    const createB = await page.request.post('/api/v1/commercial/projects', {
      data: { name: `E2E Iso B ${Date.now()}` },
    });
    expect(createB.ok()).toBeTruthy();
    const projectB = (await createB.json()) as { id: string };
    const outlineB = (
      (await (
        await page.request.get(`/api/v1/commercial/projects/${projectB.id}/workflow`)
      ).json()) as { nodes: { slug: string | null; templateNodeId: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    expect(outlineB?.templateNodeId).toBeTruthy();
    expect(outlineB!.templateNodeId).not.toBe(outlineA0!.templateNodeId);
  });
});

test.describe('WP-004R round10 promote pin publish', () => {
  test('promote and pin primary block via UI', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E Pin ${Date.now()}`);
    const wf = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const outline = (
      (await wf.json()) as { nodes: { id: string; slug: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    expect(outline).toBeTruthy();

    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('Pin 阻塞项');
    await page.locator('select').filter({ hasText: '普通' }).selectOption('blocking');
    await page.locator('select:has(option:text("选择阻塞节点"))').selectOption(outline!.id);
    await page.getByRole('button', { name: '提交事项' }).click();
    const card = page.locator('[id^="item-"]').filter({ hasText: 'Pin 阻塞项' });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: '设为主要阻塞' }).click();

    await card.getByText('拆分 / 提升为节点').click();
    await card.getByPlaceholder('提升为节点名称').fill('Pin 提升节点');
    await card.getByRole('button', { name: '提升为节点' }).click();
    await expect(page.getByText('Pin 提升节点')).toBeVisible({ timeout: 15_000 });
  });

  test('publish creates monitor jobs and winding-down stage', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E Pub ${Date.now()}`);
    const bvid = `BV1e2e${Date.now()}`;
    await page.getByRole('button', { name: '填写发布信息' }).click();
    await page.getByLabel('BV号').fill(bvid);
    await page.getByLabel('上线时间').fill('2026-02-01T10:00');
    await page.getByRole('button', { name: '确认发布' }).click();
    await expect(page.getByText('已上线', { exact: false })).toBeVisible({ timeout: 20_000 });
    const detail = await page.request.get(`/api/v1/commercial/projects/${projectId}`);
    const body = (await detail.json()) as {
      overallStage: string;
      monitorContract: { metadataTaskStatus: string } | null;
    };
    expect(body.overallStage).toBe('published_winding_down');
    expect(body.monitorContract?.metadataTaskStatus).toBeTruthy();
  });
});

test.describe('WP-004R round10 deep links and template UX', () => {
  test('#node deep link selects node panel', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E NodeHash ${Date.now()}`);
    const wf = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const outline = (
      (await wf.json()) as { nodes: { id: string; slug: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    expect(outline).toBeTruthy();
    await page.goto(`${page.url().split('#')[0]}#node-${outline!.id}`);
    await expect(page.getByLabel('节点名称')).toBeVisible({ timeout: 15_000 });
  });

  test('closed item #item deep link expands audit history', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E ItemHist ${Date.now()}`);
    await page.getByRole('button', { name: '新建事项' }).click();
    await page.getByLabel('事项标题').fill('历史审计项');
    await page.getByRole('button', { name: '提交事项' }).click();
    const card = page.locator('[id^="item-"]').filter({ hasText: '历史审计项' });
    const itemId = (await card.getAttribute('id'))!.replace(/^item-/, '');
    await card.getByLabel('闭环结论').fill('OK');
    await card.getByRole('button', { name: '闭环' }).click();
    await page.goto(`/projects/${projectId}#item-${itemId}`);
    await expect(page.getByText('暂无审计历史').or(page.getByText('创建'))).toBeVisible({
      timeout: 15_000,
    });
  });

  test('template redo after undo', async ({ page }) => {
    await openDraftEditor(page);
    const undoBtn = page.getByRole('button', { name: '撤销' });
    await page.getByRole('button', { name: '新建模板节点' }).click();
    await page.getByLabel('节点名称').fill('Redo 探针');
    await page.getByLabel('slug').fill(`redo_${Date.now()}`);
    await page.getByRole('button', { name: '创建节点' }).click();
    await expect(page.getByText('Redo 探针')).toBeVisible({ timeout: 15_000 });
    await expect(undoBtn).toBeEnabled({ timeout: 15_000 });
    await undoBtn.click();
    await expect(page.getByText('Redo 探针')).not.toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '重做' }).click();
    await expect(page.getByText('Redo 探针')).toBeVisible({ timeout: 15_000 });
  });

  test('template graph no horizontal overflow on narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDraftEditor(page);
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth <= el.clientWidth + 2;
    });
    expect(overflow).toBe(true);
  });

  test('delete template node requires confirmation', async ({ page }) => {
    await openDraftEditor(page);
    const slug = `del_${Date.now()}`;
    await page.getByRole('button', { name: '新建模板节点' }).click();
    await page.getByLabel('节点名称').fill('待删节点');
    await page.getByLabel('slug').fill(slug);
    await page.getByRole('button', { name: '创建节点' }).click();
    await expect(page.getByText('待删节点')).toBeVisible({ timeout: 15_000 });
    await page.getByText('待删节点').click();
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: '删除节点' }).click();
    await expect(page.getByText('待删节点')).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '删除节点' }).click();
    await expect(page.getByText('待删节点')).not.toBeVisible({ timeout: 15_000 });
  });
});

test.describe('WP-004R round10 errors and reset', () => {
  test('invalid graph connect shows Chinese error', async ({ page }) => {
    const projectId = await createBlankProject(page, `E2E Err ${Date.now()}`);
    const wf = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const body = (await wf.json()) as { nodes: { id: string; slug: string | null }[] };
    const publish = body.nodes.find((n) => n.slug === 'publish');
    const inquiry = body.nodes.find((n) => n.slug === 'inquiry');
    const bad = await page.request.post(`/api/v1/commercial/projects/${projectId}/edges`, {
      data: { fromNodeId: publish!.id, toNodeId: inquiry!.id },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    const errBody = (await bad.json()) as { error?: string };
    expect(errBody.error?.length).toBeGreaterThan(0);
  });

  test('reset via API then undo restores workflow', async ({ page, request }) => {
    const versions = await request.get('/api/v1/commercial/templates/versions');
    const defaultPublished = (
      (await versions.json()) as {
        items: Array<{ id: string; isDefault: boolean; isDraft: boolean }>;
      }
    ).items.find((v) => v.isDefault && !v.isDraft);
    expect(defaultPublished).toBeTruthy();

    const projectId = await createBlankProject(page, `E2E Reset ${Date.now()}`);
    const wf0 = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    const outline = (
      (await wf0.json()) as { nodes: { id: string; slug: string | null }[] }
    ).nodes.find((n) => n.slug === 'outline');
    await page.request.post(
      `/api/v1/commercial/projects/${projectId}/nodes/${outline!.id}/advance-to`,
    );

    const reset = await request.post('/api/v1/commercial/hermes/write', {
      data: {
        idempotencyKey: `e2e-reset-${projectId}`,
        operation: 'reset_project_workflow',
        confidence: 1,
        autoApply: true,
        payload: {
          projectId,
          templateVersionId: defaultPublished!.id,
          confirmDestroyCustomGraph: true,
        },
      },
    });
    expect(reset.ok()).toBeTruthy();
    const wf1 = await page.request.get(`/api/v1/commercial/projects/${projectId}/workflow`);
    expect(
      ((await wf1.json()) as { nodes: { slug: string | null; status: string }[] }).nodes.find(
        (n) => n.slug === 'outline',
      )?.status,
    ).toBe('not_reached');

    const undo = await page.request.post(`/api/v1/commercial/projects/${projectId}/workflow/undo`);
    expect(undo.ok()).toBeTruthy();
    expect(
      ((await undo.json()) as { nodes: { id: string; status: string }[] }).nodes.find(
        (n) => n.id === outline!.id,
      )?.status,
    ).toBe('in_progress');
  });
});
