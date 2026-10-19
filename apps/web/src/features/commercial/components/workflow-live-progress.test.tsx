import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { LiveProjectWorkflow } from './live-project-workflow';

setDefaultTimeout(30_000);

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';
const WORKFLOW_ID = 'a2000001-0001-4001-8001-000000000001';
const TEMPLATE_ID = 'ffff1111-1111-4111-8111-111111111111';

const ID = {
  outline: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  copy: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  aRoll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
  publish: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a',
  other: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000e',
  merge: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
} as const;

const EDGE_OUTLINE_COPY = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const EDGE_COPY_MERGE = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

type Row = {
  id: string;
  name: string;
  status: string;
  kind: 'stage' | 'merge';
  templateSlug: string | null;
  blockingReason: string | null;
  plannedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type StepBody = {
  direction?: string;
  force?: boolean;
  expectedUpdatedAt?: string;
  publish?: { idempotencyKey?: string; bvid?: string; publishedAt?: string } | null;
};

type Posted = { url: string; body: StepBody };

const LONG_REASON =
  '甲方把批注写在第三页边栏，需要逐条改完才能继续，这段原因要完整留在展开的图节点上，不能被截成省略号';

function row(
  id: string,
  name: string,
  status: string,
  slug: string | null,
  extra: Partial<Row> = {},
): Row {
  return {
    id,
    name,
    status,
    kind: slug === 'merge' ? 'merge' : 'stage',
    templateSlug: slug,
    blockingReason: null,
    plannedAt: null,
    completedAt: null,
    updatedAt: '2026-05-20T12:00:00.000000Z',
    ...extra,
  };
}

function detailPayload(overallStage = 'pre_publish', published = false) {
  return {
    id: PROJECT_ID,
    name: '图上逐步样例',
    netAmount: '18000.00',
    rebateAmount: '600.00',
    overallStage,
    currentStageNames: ['文案'],
    anyNodeBlocked: true,
    blockingReason: LONG_REASON,
    publish: published
      ? {
          published: true,
          bvid: 'BV1xx411c7mD',
          publishedAt: '2026-05-20T12:00:00.000Z',
          publishSource: 'web',
          idempotencyKey: 'publish-key-1',
        }
      : {
          published: false,
          bvid: null,
          publishedAt: null,
          publishSource: null,
          idempotencyKey: null,
        },
  };
}

function installApi(options: {
  rows: Row[];
  edges?: { id: string; fromNodeId: string; toNodeId: string }[];
  overallStage?: string;
  published?: boolean;
  onStep?: (url: string, body: StepBody, rows: Row[]) => Response | Promise<Response>;
  onPlan?: (url: string, body: { plannedAt: string | null; expectedUpdatedAt: string }) => Response;
}) {
  const posts: Posted[] = [];
  const planPosts: {
    url: string;
    body: { plannedAt: string | null; expectedUpdatedAt: string };
  }[] = [];
  let gets = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.includes('/plan')) {
      const body = JSON.parse(String(init.body)) as {
        plannedAt: string | null;
        expectedUpdatedAt: string;
      };
      planPosts.push({ url, body });
      if (options.onPlan) return options.onPlan(url, body);
      return new Response(JSON.stringify({ error: '未处理的计划写入', code: 'invalid_body' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (init?.method === 'POST' && url.includes('/step')) {
      const body = JSON.parse(String(init.body)) as StepBody;
      posts.push({ url, body });
      if (!options.onStep) {
        return new Response(JSON.stringify({ error: '未处理的逐步', code: 'invalid_body' }), {
          status: 400,
        });
      }
      return options.onStep(url, body, options.rows);
    }
    gets += 1;
    if (url.includes('/api/v1/monitor') || url.includes('/monitoring')) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const payload = url.endsWith('/workflow')
      ? {
          projectId: PROJECT_ID,
          workflowId: WORKFLOW_ID,
          templateVersionId: TEMPLATE_ID,
          nodes: options.rows,
          edges: options.edges ?? [
            { id: EDGE_OUTLINE_COPY, fromNodeId: ID.outline, toNodeId: ID.copy },
            { id: EDGE_COPY_MERGE, fromNodeId: ID.copy, toNodeId: ID.merge },
          ],
        }
      : detailPayload(options.overallStage, options.published);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    posts,
    planPosts,
    gets: () => gets,
  };
}

function stepOk(subject: Row) {
  return new Response(
    JSON.stringify({
      projectId: PROJECT_ID,
      overallStage: 'pre_publish',
      nodes: [
        {
          id: subject.id,
          name: subject.name,
          status: subject.status,
          kind: subject.kind,
          updatedAt: subject.updatedAt,
          statusBeforeBlock: null,
          primaryBlockItemId: null,
          plannedAt: subject.plannedAt,
          completedAt: subject.completedAt,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function advance(subject: Row, direction: string) {
  if (direction === 'forward') {
    subject.status = subject.status === 'not_reached' ? 'in_progress' : 'completed';
    if (subject.status === 'completed') subject.completedAt = '2026-05-21T12:00:00.000000Z';
  } else if (subject.status === 'completed') {
    subject.status = 'in_progress';
    subject.completedAt = null;
  } else {
    subject.status = 'not_reached';
    subject.completedAt = null;
  }
  subject.updatedAt = '2026-05-21T12:00:00.000000Z';
}

function renderProject(width = 1280) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div style={{ width, height: 900 }}>
          <LiveProjectWorkflow projectId={PROJECT_ID} />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ready(container: HTMLElement) {
  await screen.findByRole('heading', { name: '图上逐步样例' });
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

function graphCard(container: HTMLElement, id: string): HTMLElement {
  const card = container.querySelector(`[data-workflow-node="${id}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`missing graph node ${id}`);
  return card;
}

function expand(card: HTMLElement) {
  const button = card.querySelector('[data-testid="workflow-node-expand"]');
  if (!(button instanceof HTMLElement)) throw new Error('missing expand');
  fireEvent.click(button);
}

function labels(root: ParentNode, testId: string): string[] {
  return [...root.querySelectorAll(`[data-testid="${testId}"]`)].map(
    (item) => item.textContent ?? '',
  );
}

function viewportTransform(container: HTMLElement): string {
  const raw = container.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
  return raw.match(/transform:\s*([^;]+)/)?.[1]?.trim() ?? '';
}

function nodeTranslate(container: HTMLElement, id: string): string {
  const style =
    container.querySelector(`.react-flow__node[data-id="${id}"]`)?.getAttribute('style') ?? '';
  return style.match(/transform:\s*([^;]+)/)?.[1]?.trim() ?? '';
}

function connectionSignature(container: HTMLElement): string {
  const nodes = [...container.querySelectorAll('.react-flow__node')]
    .map((node) => node.getAttribute('data-id'))
    .sort();
  const edges = [...container.querySelectorAll('.react-flow__edge')]
    .map((edge) => edge.getAttribute('data-id'))
    .sort();
  return JSON.stringify({ nodes, edges });
}

function handleSides(card: HTMLElement): string[] {
  return [...card.querySelectorAll('.react-flow__handle')].map((handle) =>
    [...handle.classList].filter((name) => name.startsWith('react-flow__handle-')).join(' '),
  );
}

function openTimeline(stageId: string) {
  const stage = screen
    .getAllByTestId('progress-stage')
    .find((item) => item.getAttribute('data-stage-id') === stageId);
  if (!stage) throw new Error(`missing stage ${stageId}`);
  if (stage.getAttribute('data-selected') !== 'true') fireEvent.click(stage);
  return stage;
}

function timelineCard(slug: string): HTMLElement {
  const card = within(screen.getByTestId('progress-stage-detail'))
    .getAllByTestId('progress-stage-node')
    .find((item) => item.getAttribute('data-node-id') === slug);
  if (!card) throw new Error(`missing timeline ${slug}`);
  return card;
}

describe('live graph step controls', () => {
  test('graph buttons follow the shared step result and keep topology, selection, and viewport', async () => {
    const rows = [
      row(ID.outline, '大纲', 'not_reached', 'outline'),
      row(ID.copy, '文案', 'blocked', 'copy', { blockingReason: LONG_REASON }),
      row(ID.aRoll, 'A-roll 拍摄', 'in_progress', 'a_roll', {
        plannedAt: '2026-04-18T06:30:00.000Z',
        completedAt: null,
      }),
      row(ID.publish, '发布', 'completed', 'publish', {
        plannedAt: '2026-04-02T16:00:00.000Z',
        completedAt: '2026-04-09T02:00:00.000Z',
      }),
      row(ID.other, '其他', 'not_applicable', 'other'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const api = installApi({
      rows,
      onStep: (url, body) => {
        const subject = rows.find((item) => url.includes(item.id));
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        advance(subject, body.direction ?? 'forward');
        return stepOk(subject);
      },
    });
    const { container, unmount } = renderProject();
    await ready(container);

    const beforeView = viewportTransform(container);
    const beforeLinks = connectionSignature(container);
    expect(beforeLinks).toContain(ID.outline);
    expect(beforeLinks).toContain(ID.merge);
    expect(beforeLinks).toContain(EDGE_OUTLINE_COPY);
    expect(beforeLinks).toContain(EDGE_COPY_MERGE);
    expect(container.querySelector('[data-workflow-junction="anchor"]')).toBeTruthy();
    expect(
      container.querySelector(`[data-id="${ID.merge}"] [data-testid="workflow-node-expand"]`),
    ).toBeNull();
    expect(container.querySelector(`[data-id="${ID.merge}"] [data-testid="node-step"]`)).toBeNull();

    const outline = graphCard(container, ID.outline);
    fireEvent.click(outline);
    expand(outline);
    expect(outline.querySelector('[data-testid="workflow-node-status"]')).toBeNull();
    expect(outline.querySelector('[aria-label="阻塞原因"]')).toBeNull();
    const outlineActions = within(outline).getByTestId('node-step-actions');
    expect(outlineActions.getAttribute('data-status')).toBe('not_reached');
    expect(outlineActions.getAttribute('data-surface')).toBe('detail');
    expect(labels(outlineActions, 'node-step')).toEqual(['推进']);
    expect(outline.querySelector('[data-testid="node-step"]')?.getAttribute('data-variant')).toBe(
      'default',
    );
    expect(outline.querySelector('[data-testid="node-step"]')?.getAttribute('data-pending')).toBe(
      'false',
    );
    expect(outline.querySelector('[data-testid="node-rollback"]')).toBeNull();
    expect(outlineActions.childElementCount).toBe(1);

    const afterExpand = viewportTransform(container);
    const outlinePlaced = nodeTranslate(container, ID.outline);
    expect(afterExpand).toBe(beforeView);
    expect(connectionSignature(container)).toBe(beforeLinks);
    expect(
      outline.getAttribute('aria-expanded') ??
        outline.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'),
    ).toBe('true');

    openTimeline('write_outline');
    fireEvent.click(within(outline).getByTestId('node-step'));
    await waitFor(() => {
      expect(graphCard(container, ID.outline).getAttribute('data-workflow-status')).toBe(
        'in_progress',
      );
    });
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe(
      `/api/v1/commercial/projects/${PROJECT_ID}/nodes/${ID.outline}/step`,
    );
    expect(api.posts[0]?.url.includes('/advance')).toBe(false);
    expect(api.posts[0]?.body).toMatchObject({
      direction: 'forward',
      expectedUpdatedAt: '2026-05-20T12:00:00.000000Z',
      force: false,
      publish: null,
    });
    const progressed = graphCard(container, ID.outline);
    expect(labels(progressed, 'node-step')).toEqual(['完成']);
    expect(labels(progressed, 'node-rollback')).toEqual(['回退']);
    expect(
      progressed.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant'),
    ).toBe('secondary');
    expect(timelineCard('outline').getAttribute('data-status')).toBe('in_progress');
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('blocked');
    expect(viewportTransform(container)).toBe(beforeView);
    expect(nodeTranslate(container, ID.outline)).toBe(outlinePlaced);
    expect(connectionSignature(container)).toBe(beforeLinks);
    expect(container.querySelector('.react-flow__node.selected')?.getAttribute('data-id')).toBe(
      ID.outline,
    );
    expect(openTimeline('write_outline').getAttribute('data-selected')).toBe('true');

    fireEvent.click(within(progressed).getByTestId('node-step'));
    await waitFor(() => {
      expect(graphCard(container, ID.outline).getAttribute('data-workflow-status')).toBe(
        'completed',
      );
    });
    expect(graphCard(container, ID.outline).querySelector('[data-testid="node-step"]')).toBeNull();
    expect(
      graphCard(container, ID.outline)
        .querySelector('[data-testid="node-rollback"]')
        ?.getAttribute('data-variant'),
    ).toBe('destructive');
    expect(timelineCard('outline').getAttribute('data-status')).toBe('completed');

    fireEvent.click(within(graphCard(container, ID.outline)).getByTestId('node-rollback'));
    await waitFor(() => {
      expect(graphCard(container, ID.outline).getAttribute('data-workflow-status')).toBe(
        'in_progress',
      );
    });
    fireEvent.click(within(graphCard(container, ID.outline)).getByTestId('node-rollback'));
    await waitFor(() => {
      expect(graphCard(container, ID.outline).getAttribute('data-workflow-status')).toBe(
        'not_reached',
      );
    });
    expect(labels(graphCard(container, ID.outline), 'node-step')).toEqual(['推进']);
    expect(timelineCard('outline').getAttribute('data-status')).toBe('not_reached');
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('blocked');

    const copy = graphCard(container, ID.copy);
    expand(copy);
    expect(within(copy).getByTestId('graph-node-reason').textContent).toBe(LONG_REASON);
    expect(copy.querySelector('[data-testid="graph-node-reason"]')?.className).toContain(
      'break-words',
    );
    expect(copy.querySelector('[data-testid="graph-node-reason"]')?.className).not.toContain(
      'truncate',
    );
    expect(labels(copy, 'node-step')).toEqual(['解除阻塞']);
    expect(copy.querySelector('[data-testid="node-rollback"]')).toBeNull();
    expect(copy.textContent).not.toContain('计划');

    const shooting = graphCard(container, ID.aRoll);
    expand(shooting);
    expect(labels(shooting, 'node-step')).toEqual(['完成']);
    expect(
      shooting.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant'),
    ).toBe('secondary');
    expect(shooting.textContent).toContain('计划');
    expect(shooting.textContent).not.toContain('实际');
    expect(shooting.querySelector('[data-testid="plan-date-a_roll"]')).toBeNull();

    const published = graphCard(container, ID.publish);
    expand(published);
    expect(published.querySelector('[data-testid="node-step"]')).toBeNull();
    expect(
      published.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant'),
    ).toBe('destructive');
    expect(
      published.querySelector('[data-testid="graph-node-completed-at"]')?.textContent,
    ).toContain('实际');
    expect(published.textContent).toContain('计划');

    const other = graphCard(container, ID.other);
    expand(other);
    expect(other.querySelector('[data-testid="node-step"]')).toBeNull();
    expect(labels(other, 'node-rollback')).toEqual(['回退']);
    expect(other.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant')).toBe(
      'ghost',
    );
    expect(within(other).getByTestId('graph-node-status-word').textContent).toBe('未完成');
    fireEvent.click(within(other).getByTestId('node-rollback'));
    await waitFor(() => {
      expect(graphCard(container, ID.other).getAttribute('data-workflow-status')).toBe(
        'not_reached',
      );
    });
    expect(labels(graphCard(container, ID.other), 'node-step')).toEqual(['推进']);
    expect(
      within(graphCard(container, ID.other)).getByTestId('graph-node-status-word').textContent,
    ).toBe('未完成');

    expect(handleSides(graphCard(container, ID.outline)).join(' ')).toContain('left');
    expect(handleSides(graphCard(container, ID.outline)).join(' ')).toContain('right');
    fireEvent.click(screen.getByRole('button', { name: '纵向' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(container.querySelector('.workflow-mock-flow')?.className).toContain('is-vertical');
    const verticalView = viewportTransform(container);
    expect(handleSides(graphCard(container, ID.outline)).join(' ')).toContain('top');
    expect(handleSides(graphCard(container, ID.outline)).join(' ')).toContain('bottom');
    const posted = api.posts.length;
    fireEvent.click(within(graphCard(container, ID.outline)).getByTestId('node-step'));
    await waitFor(() => {
      expect(graphCard(container, ID.outline).getAttribute('data-workflow-status')).toBe(
        'in_progress',
      );
    });
    expect(api.posts.length).toBe(posted + 1);
    expect(viewportTransform(container)).toBe(verticalView);
    expect(handleSides(graphCard(container, ID.outline)).join(' ')).toContain('top');
    expect(connectionSignature(container)).toBe(beforeLinks);

    unmount();
    const reloaded = renderProject();
    await ready(reloaded.container);
    expect(graphCard(reloaded.container, ID.outline).getAttribute('data-workflow-status')).toBe(
      'in_progress',
    );
    expect(graphCard(reloaded.container, ID.copy).getAttribute('data-workflow-status')).toBe(
      'blocked',
    );
    openTimeline('write_outline');
    expect(timelineCard('outline').getAttribute('data-status')).toBe('in_progress');
    expect(connectionSignature(reloaded.container)).toBe(beforeLinks);
  });

  test('blocker cancel writes nothing, and locate is a deliberate timeline selection', async () => {
    const rows = [
      row(ID.outline, '大纲', 'completed', 'outline'),
      row(ID.copy, '文案', 'blocked', 'copy', { blockingReason: '等甲方' }),
      row(ID.aRoll, 'A-roll 拍摄', 'not_reached', 'a_roll'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const api = installApi({
      rows,
      onStep: (url, body) => {
        const subject = rows.find((item) => url.includes(item.id));
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        if (subject.status === 'blocked' && !body.force) {
          return new Response(
            JSON.stringify({
              error: '有开放阻塞，确认后才会关闭',
              code: 'confirmation_required',
              names: [subject.name],
              blocks: [
                {
                  nodeId: subject.id,
                  nodeName: subject.name,
                  reason: subject.blockingReason,
                  itemId: 'f0a10001-0001-4001-8001-0000000000a4',
                },
              ],
              effects: [
                { nodeId: subject.id, nodeName: subject.name, from: 'blocked', to: 'in_progress' },
              ],
              successors: [],
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        subject.status = 'in_progress';
        subject.blockingReason = null;
        subject.updatedAt = '2026-05-21T12:00:00.000000Z';
        return stepOk(subject);
      },
    });
    const { container } = renderProject();
    await ready(container);
    const selected = openTimeline('write_outline');
    const copy = graphCard(container, ID.copy);
    expand(copy);
    fireEvent.pointerMove(
      screen
        .getAllByTestId('progress-stage')
        .find((item) => item.getAttribute('data-stage-id') === 'copy_prep')!,
    );
    fireEvent.click(within(copy).getByTestId('node-step'));
    const dialog = await screen.findByTestId('step-confirm');
    expect(screen.getAllByTestId('step-confirm')).toHaveLength(1);
    expect(dialog.textContent).toContain('等甲方');
    expect(dialog.textContent).toContain('关闭阻塞并恢复');
    expand(copy);
    const tip = screen.queryByTestId('progress-stage-tooltip');
    if (tip) fireEvent.pointerLeave(tip, { relatedTarget: document.body });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(screen.getByTestId('step-confirm')).toBeTruthy();
    expect(copy.querySelector('[data-testid="workflow-node-detail"]')).toBeNull();
    fireEvent.click(screen.getByTestId('step-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-confirm')).toBeNull());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body.force).toBe(false);
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('blocked');
    expect(selected.getAttribute('data-selected')).toBe('true');

    expand(graphCard(container, ID.copy));
    fireEvent.click(within(graphCard(container, ID.copy)).getByTestId('node-step'));
    await screen.findByTestId('step-confirm');
    fireEvent.click(screen.getByTestId('step-confirm-force'));
    await waitFor(() => {
      expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe(
        'in_progress',
      );
    });
    expect(api.posts.filter((post) => post.body.force).length).toBe(1);
    expect(openTimeline('write_outline').getAttribute('data-selected')).toBe('true');
  });

  test('a successor refusal stays on the expanded card and locate opens that stage', async () => {
    const rows = [
      row(ID.outline, '大纲', 'completed', 'outline'),
      row(ID.copy, '文案', 'in_progress', 'copy'),
      row(ID.aRoll, 'A-roll 拍摄', 'in_progress', 'a_roll'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const api = installApi({
      rows,
      onStep: () =>
        new Response(
          JSON.stringify({
            error: '无法回退，后续节点已推进：A-roll 拍摄',
            code: 'successors_advanced',
            names: ['A-roll 拍摄'],
            successors: [{ nodeId: ID.aRoll, nodeName: 'A-roll 拍摄', templateSlug: 'a_roll' }],
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    });
    const { container } = renderProject();
    await ready(container);
    openTimeline('copy_prep');
    const copy = graphCard(container, ID.copy);
    expand(copy);
    const view = viewportTransform(container);
    fireEvent.click(within(copy).getByTestId('node-rollback'));
    const error = await within(copy).findByTestId('graph-step-error');
    expect(error.textContent).toContain('A-roll 拍摄');
    expect(error.className).not.toContain('truncate');
    expect(screen.getByTestId('step-error').textContent).toContain('A-roll 拍摄');
    expect(copy.getAttribute('data-workflow-status')).toBe('in_progress');
    expect(openTimeline('copy_prep').getAttribute('data-selected')).toBe('true');
    expect(viewportTransform(container)).toBe(view);
    fireEvent.click(within(copy).getByTestId(`graph-step-locate-${ID.aRoll}`));
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId('progress-stage')
          .find((item) => item.getAttribute('data-stage-id') === 'production')
          ?.getAttribute('data-selected'),
      ).toBe('true');
    });
    expect(api.posts).toHaveLength(1);
    expect(connectionSignature(container)).toContain(EDGE_OUTLINE_COPY);
  });

  test('publish reuses the recorded key, and cancel does not send a second write', async () => {
    const rows = [
      row(ID.outline, '大纲', 'completed', 'outline'),
      row(ID.publish, '发布', 'in_progress', 'publish'),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const api = installApi({
      rows,
      published: true,
      onStep: (url, body) => {
        const subject = rows.find((item) => url.includes(item.id));
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        if (!body.publish) {
          return new Response(
            JSON.stringify({
              error: '发布节点要补上已有记录',
              code: 'publish_required',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        subject.status = 'completed';
        subject.completedAt = '2026-05-20T12:00:00.000Z';
        subject.updatedAt = '2026-05-21T12:00:00.000000Z';
        return stepOk(subject);
      },
    });
    const { container } = renderProject();
    await ready(container);
    const publish = graphCard(container, ID.publish);
    expand(publish);
    fireEvent.click(within(publish).getByTestId('node-step'));
    const dialog = await screen.findByTestId('step-publish');
    expect((within(dialog).getByTestId('step-publish-bvid') as HTMLInputElement).value).toBe(
      'BV1xx411c7mD',
    );
    expect(
      (within(dialog).getByTestId('step-publish-at') as HTMLInputElement).value.length,
    ).toBeGreaterThan(0);
    expand(publish);
    expect(screen.getByTestId('step-publish')).toBeTruthy();
    fireEvent.click(screen.getByTestId('step-publish-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-publish')).toBeNull());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body.publish ?? null).toBeNull();
    expect(graphCard(container, ID.publish).getAttribute('data-workflow-status')).toBe(
      'in_progress',
    );
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('not_reached');

    expand(graphCard(container, ID.publish));
    fireEvent.click(within(graphCard(container, ID.publish)).getByTestId('node-step'));
    const again = await screen.findByTestId('step-publish');
    expect((within(again).getByTestId('step-publish-bvid') as HTMLInputElement).value).toBe(
      'BV1xx411c7mD',
    );
    fireEvent.click(within(again).getByTestId('step-publish-submit'));
    await waitFor(() => {
      expect(graphCard(container, ID.publish).getAttribute('data-workflow-status')).toBe(
        'completed',
      );
    });
    const recorded = api.posts.filter((post) => post.body.publish);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.body.publish).toMatchObject({
      idempotencyKey: 'publish-key-1',
      bvid: 'BV1xx411c7mD',
      platform: 'bilibili',
    });
    expect(recorded[0]?.url.endsWith(`/nodes/${ID.publish}/step`)).toBe(true);
    expect(api.posts.filter((post) => post.body.publish == null).length).toBeGreaterThan(0);
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('not_reached');
  });

  test('a rejected request and a stale token stay retryable without moving the graph', async () => {
    const rows = [
      row(ID.outline, '大纲', 'not_reached', 'outline'),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    let mode: 'throw' | 'stale' | 'ok' = 'throw';
    const api = installApi({
      rows,
      onStep: (url, body) => {
        const subject = rows.find((item) => url.includes(item.id));
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        if (mode === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
        if (mode === 'stale') {
          return new Response(
            JSON.stringify({
              error: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
              code: 'stale_write',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        expect(body.expectedUpdatedAt).toBe(subject.updatedAt);
        advance(subject, 'forward');
        return stepOk(subject);
      },
    });
    const { container } = renderProject();
    await ready(container);
    const outline = graphCard(container, ID.outline);
    expand(outline);
    const view = viewportTransform(container);
    const placed = nodeTranslate(container, ID.outline);
    fireEvent.click(within(graphCard(container, ID.outline)).getByTestId('node-step'));
    const error = await within(graphCard(container, ID.outline)).findByTestId('graph-step-error');
    expect(error.textContent).toContain('Failed to fetch');
    expect(outline.getAttribute('data-workflow-status')).toBe('not_reached');
    expect(
      within(graphCard(container, ID.outline)).getByTestId('node-step').hasAttribute('disabled'),
    ).toBe(false);
    mode = 'stale';
    fireEvent.click(within(outline).getByTestId('node-step'));
    await waitFor(() => {
      expect(within(outline).getByTestId('graph-step-error').textContent).toContain(
        '并发令牌已过期',
      );
    });
    rows[0]!.updatedAt = '2026-05-22T12:00:00.000000Z';
    const gets = api.gets();
    fireEvent.click(within(outline).getByTestId('graph-step-refresh'));
    await waitFor(() => expect(api.gets()).toBeGreaterThan(gets));
    mode = 'ok';
    fireEvent.click(within(outline).getByTestId('node-step'));
    await waitFor(() => expect(outline.getAttribute('data-workflow-status')).toBe('in_progress'));
    expect(api.posts.at(-1)?.body.expectedUpdatedAt).toBe('2026-05-22T12:00:00.000000Z');
    expect(viewportTransform(container)).toBe(view);
    expect(nodeTranslate(container, ID.outline)).toBe(placed);
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('not_reached');
  });

  test('pending on the graph locks the timeline button and ignores a second click', async () => {
    const rows = [
      row(ID.outline, '大纲', 'not_reached', 'outline'),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const gate: { open: (() => void) | null } = { open: null };
    const api = installApi({
      rows,
      onStep: (url) => {
        const subject = rows.find((item) => url.includes(item.id));
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        return new Promise<Response>((resolve) => {
          gate.open = () => {
            advance(subject, 'forward');
            resolve(stepOk(subject));
          };
        });
      },
    });
    const { container } = renderProject();
    await ready(container);
    openTimeline('write_outline');
    const outline = graphCard(container, ID.outline);
    expand(outline);
    fireEvent.click(within(outline).getByTestId('node-step'));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    fireEvent.click(within(outline).getByTestId('node-step'));
    fireEvent.click(within(timelineCard('outline')).getByTestId('node-step'));
    expect(api.posts).toHaveLength(1);
    expect(within(outline).getByTestId('node-step').getAttribute('data-pending')).toBe('true');
    expect(
      within(timelineCard('outline')).getByTestId('node-step').getAttribute('data-pending'),
    ).toBe('true');
    const release = gate.open;
    if (!release) throw new Error('step did not start');
    release();
    await waitFor(() => expect(outline.getAttribute('data-workflow-status')).toBe('in_progress'));
    expect(timelineCard('outline').getAttribute('data-status')).toBe('in_progress');
    expect(api.posts).toHaveLength(1);
  });

  test('plan pencil save, clear, and error agree on the graph and the timeline', async () => {
    const rows = [
      row(ID.outline, '大纲', 'in_progress', 'outline', {
        plannedAt: '2026-04-01T16:00:00.000Z',
      }),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    const api = installApi({
      rows,
      onPlan: (_url, body) => {
        if (body.plannedAt === '2026-04-20') {
          return new Response(
            JSON.stringify({
              error: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
              code: 'stale_write',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        const subject = rows[0]!;
        subject.plannedAt =
          body.plannedAt === null
            ? null
            : new Date(`${body.plannedAt}T00:00:00+08:00`).toISOString();
        subject.updatedAt = '2026-05-21T12:00:00.000000Z';
        return new Response(
          JSON.stringify({
            projectId: PROJECT_ID,
            node: {
              id: subject.id,
              name: subject.name,
              status: subject.status,
              kind: 'stage',
              updatedAt: subject.updatedAt,
              statusBeforeBlock: null,
              primaryBlockItemId: null,
              plannedAt: subject.plannedAt,
              completedAt: null,
            },
            blockingReason: null,
            pinnedItem: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const { container } = renderProject();
    await ready(container);
    const outline = graphCard(container, ID.outline);
    expect(outline.textContent).not.toContain('计划');
    expand(outline);
    expect(outline.textContent).toContain('计划');
    expect(outline.querySelector('[data-testid="plan-date-outline"]')).toBeNull();
    fireEvent.click(within(outline).getByTestId('plan-date-edit-outline'));
    const input = within(outline).getByTestId('plan-date-outline') as HTMLInputElement;
    expect(input.value).toBe('2026-04-02');
    const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!(shell instanceof HTMLElement)) throw new Error('missing shell');
    input.focus();
    fireEvent.keyDown(shell, { key: 'Enter' });
    fireEvent.keyDown(shell, { key: 'l' });
    fireEvent.keyDown(shell, { key: 'f' });
    expect(container.querySelector('[data-testid="workflow-node-name"]')).toBeNull();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(outline).getByTestId('plan-date-save-outline'));
    expect(within(outline).getByTestId('plan-date-error').textContent).toContain('请选择日期');
    expect(api.planPosts).toHaveLength(0);

    fireEvent.change(input, { target: { value: '2026-04-20' } });
    fireEvent.click(within(outline).getByTestId('plan-date-save-outline'));
    await waitFor(() => {
      expect(within(outline).getByTestId('plan-date-error').textContent).toContain(
        '并发令牌已过期',
      );
    });
    fireEvent.change(input, { target: { value: '2026-04-09' } });
    fireEvent.click(within(outline).getByTestId('plan-date-save-outline'));
    await waitFor(() => expect(outline.textContent).toContain('4月9日'));
    expect(api.planPosts.at(-1)).toMatchObject({
      body: { plannedAt: '2026-04-09', expectedUpdatedAt: '2026-05-20T12:00:00.000000Z' },
    });
    expect(api.planPosts.at(-1)?.url.endsWith(`/nodes/${ID.outline}/plan`)).toBe(true);
    openTimeline('write_outline');
    expect(timelineCard('outline').textContent).toContain('4月9日');
    expect(timelineCard('outline').textContent).not.toContain('实际');

    fireEvent.click(within(outline).getByTestId('plan-date-clear-outline'));
    await waitFor(() => expect(outline.textContent).not.toContain('4月9日'));
    expect(api.planPosts.at(-1)?.body.plannedAt).toBeNull();
    expect(timelineCard('outline').textContent).not.toContain('计划');
    expect(timelineCard('outline').textContent).not.toContain('4月9日');
    expect(graphCard(container, ID.copy).getAttribute('data-workflow-status')).toBe('not_reached');
  });

  test('archived graphs have no writers, and a session rename does not survive reload', async () => {
    const rows = [
      row(ID.outline, '大纲', 'blocked', 'outline', { blockingReason: '等甲方' }),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    installApi({ rows, overallStage: 'archived' });
    const { container, unmount } = renderProject();
    await ready(container);
    expect(screen.getByText('该项目已结案归档，流程只读。')).toBeTruthy();
    const outline = graphCard(container, ID.outline);
    expand(outline);
    expect(outline.querySelector('[data-testid="workflow-node-status"]')).toBeNull();
    expect(outline.querySelector('[data-testid="node-step"]')).toBeNull();
    expect(outline.querySelector('[data-testid="node-rollback"]')).toBeNull();
    expect(outline.querySelector('[data-testid="plan-date-edit-outline"]')).toBeNull();
    expect(within(outline).getByTestId('graph-node-reason').textContent).toBe('等甲方');
    const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!(shell instanceof HTMLElement)) throw new Error('missing shell');
    fireEvent.click(outline);
    fireEvent.keyDown(shell, { key: 'Enter' });
    expect(container.querySelector('[data-testid="workflow-node-name"]')).toBeNull();
    openTimeline('write_outline');
    expect(
      within(screen.getByTestId('progress-stage-detail')).queryByTestId('node-step'),
    ).toBeNull();
    expect(
      within(screen.getByTestId('progress-stage-detail')).queryByTestId('plan-date-edit-outline'),
    ).toBeNull();

    unmount();
    const editable = [
      row(ID.outline, '大纲', 'not_reached', 'outline'),
      row(ID.copy, '文案', 'not_reached', 'copy'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    installApi({ rows: editable });
    const first = renderProject();
    await ready(first.container);
    const card = graphCard(first.container, ID.outline);
    fireEvent.click(card);
    const liveShell = first.container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!(liveShell instanceof HTMLElement)) throw new Error('missing shell');
    fireEvent.keyDown(liveShell, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(liveShell, { key: 'Enter' });
    const name = await within(first.container).findByTestId('workflow-node-name');
    fireEvent.change(name, { target: { value: '大纲定稿' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(card.textContent).toContain('大纲定稿'));
    openTimeline('write_outline');
    expect(timelineCard('outline').textContent).toContain('大纲定稿');
    expect(screen.getByTestId('workflow-live-counts').textContent).toContain('尚未写回数据库');
    first.unmount();
    installApi({ rows: editable });
    const reloaded = renderProject();
    await ready(reloaded.container);
    expect(graphCard(reloaded.container, ID.outline).textContent).toContain('大纲');
    expect(graphCard(reloaded.container, ID.outline).textContent).not.toContain('大纲定稿');
    openTimeline('write_outline');
    expect(timelineCard('outline').textContent).not.toContain('大纲定稿');
  });

  test('a narrow viewport still shows the full reason and the legal blocked action', async () => {
    const rows = [
      row(ID.copy, '文案', 'blocked', 'copy', { blockingReason: LONG_REASON }),
      row(ID.outline, '大纲', 'not_reached', 'outline'),
      row(ID.merge, '汇合节点', 'not_applicable', 'merge'),
    ];
    installApi({ rows });
    const { container } = renderProject(390);
    await ready(container);
    const copy = graphCard(container, ID.copy);
    expand(copy);
    expect(within(copy).getByTestId('graph-node-reason').textContent).toBe(LONG_REASON);
    expect(labels(copy, 'node-step')).toEqual(['解除阻塞']);
    expect(copy.querySelector('[data-testid="workflow-node-detail"]')?.className).toContain(
      'break-words',
    );
    expect(copy.querySelector('[data-testid="workflow-node-detail"]')?.className).not.toContain(
      'overflow-hidden',
    );
    expect(container.querySelector('[data-testid="workflow-live-canvas"]')).toBeTruthy();
  });
});
