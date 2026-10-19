import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { asLiveDetail } from '../live-read-fixture';
import { LiveProjectWorkflow } from './live-project-workflow';
import { ProgressSummary, ProgressTimeline } from './progress-timeline-view';
import type { StepCall, StepResult } from './stage-step-controls';
import type { TimelineProjectFacts } from '../progress-timeline';
import type { TimelineSourceNode } from '../progress-timeline';

const originalFetch = globalThis.fetch;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';

const NODE_IDS: Record<string, string> = {
  inquiry: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  outline: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  copy: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  pre_shoot: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
  merge: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
  a_roll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
  b_roll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007',
  ai_post: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008',
  review: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009',
  publish: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a',
  settlement: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b',
  distribution: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000c',
  data_maint: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000d',
  other: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000e',
};

function node(
  slug: string,
  name: string,
  status: string,
  blockingReason: string | null = null,
): TimelineSourceNode {
  return {
    id: NODE_IDS[slug] ?? 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff',
    name,
    status,
    kind: slug === 'merge' ? 'merge' : 'stage',
    templateSlug: slug,
    blockingReason,
  };
}

const blockedCopy: TimelineSourceNode[] = [
  node('inquiry', '询单', 'completed'),
  node('outline', '大纲', 'completed'),
  node('copy', '文案', 'blocked', '甲方文案批注未清'),
  node('pre_shoot', '预拍摄', 'in_progress'),
  node('merge', '汇合节点', 'not_reached'),
  node('a_roll', 'A-roll 拍摄', 'not_reached'),
  node('b_roll', 'B-roll 素材', 'not_reached'),
  node('ai_post', 'AI 后期', 'not_reached'),
  node('review', '审核', 'not_reached'),
  node('publish', '发布', 'not_reached'),
  node('settlement', '结算', 'not_reached'),
  node('distribution', '全平台分发', 'not_reached'),
  node('data_maint', '数据维护', 'not_reached'),
  node('other', '其他', 'not_applicable'),
];

describe('ProgressTimeline', () => {
  test('renders six points, five stage lines, and status colors', () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const points = screen.getAllByTestId('progress-point');
    const stages = screen.getAllByTestId('progress-stage');
    expect(points.map((point) => point.getAttribute('data-point-id'))).toEqual([
      'inquiry',
      'outline_locked',
      'script_locked',
      'edit_done',
      'published',
      'closed',
    ]);
    expect(points.map((point) => point.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'idle',
      'idle',
      'idle',
      'idle',
    ]);
    expect(stages.map((stage) => stage.getAttribute('data-stage-id'))).toEqual([
      'write_outline',
      'copy_prep',
      'production',
      'client_review',
      'distribution_settlement',
    ]);
    expect(stages.map((stage) => stage.getAttribute('data-status'))).toEqual([
      'done',
      'blocked',
      'idle',
      'idle',
      'idle',
    ]);
    expect(screen.getByText('悬停查看状态，点击查看详情。')).toBeTruthy();
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('点击阶段连线或终点');
    const blocked = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    const done = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    const gradient = blocked?.querySelector('[data-testid="progress-stage-gradient"]');
    const lineLabels = blocked?.querySelectorAll('[data-testid="progress-stage-line-label"]') ?? [];
    const lineLabel = lineLabels[0];
    const timeline = screen.getByTestId('progress-timeline');
    expect(timeline.querySelector('[data-testid="progress-stage-glow"]')).toBeNull();
    expect(timeline.querySelector('[stroke-dasharray]')).toBeNull();
    expect(timeline.querySelector('svg')).toBeNull();
    expect(timeline.innerHTML).not.toContain('min-h-36');
    expect(gradient?.getAttribute('data-highlight')).toBe('block');
    expect(gradient?.getAttribute('data-alpha')).toBe('0.12');
    expect(gradient?.className).not.toContain('h-24');
    expect(gradient?.getAttribute('style')).toContain('linear-gradient');
    expect(gradient?.getAttribute('style')).toContain('transparent');
    expect(gradient?.getAttribute('style')).toContain('#c2410c1f');
    expect(gradient?.getAttribute('style')).not.toContain('#c2410c47');
    expect(lineLabels).toHaveLength(1);
    expect(blocked?.querySelector('[data-testid="progress-stage-situation"]')).toBeNull();
    expect(lineLabel?.textContent).toBe('文案：阻塞');
    expect(lineLabel?.getAttribute('style')).toContain('#c2410c');
    expect(lineLabel?.getAttribute('style')).not.toContain('opacity');
    expect(blocked?.textContent).not.toContain('甲方文案批注未清');
    expect(done?.querySelector('[stroke-dasharray]')).toBeNull();
    expect(done?.querySelector('[data-testid="progress-stage-gradient"]')).toBeNull();
    expect(done?.querySelector('[data-testid="progress-stage-line-label"]')).toBeNull();
    expect(document.querySelectorAll('[stroke-dasharray]')).toHaveLength(0);
  });

  test('shows each blocked node status once, and keeps the reason in the tooltip and detail', async () => {
    render(
      <ProgressTimeline
        nodes={[
          node('inquiry', '询单', 'completed'),
          node('outline', '大纲', 'completed'),
          node('copy', '文案', 'completed'),
          node('pre_shoot', '预拍摄', 'completed'),
          node('a_roll', 'A-roll 拍摄', 'blocked', 'A-roll 素材版权待补'),
          node('b_roll', 'B-roll 素材', 'blocked', 'B-roll 甲方素材缺失'),
          node('ai_post', 'AI 后期', 'in_progress'),
        ]}
      />,
    );
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'production');
    if (!stage) throw new Error('missing production stage');
    const labels = stage.querySelectorAll('[data-testid="progress-stage-line-label"]');
    expect(labels).toHaveLength(1);
    expect(labels[0]?.textContent).toBe('A-roll 拍摄：阻塞\nB-roll 素材：阻塞');
    expect(stage.textContent).not.toContain('A-roll 素材版权待补');
    expect(stage.textContent).not.toContain('B-roll 甲方素材缺失');
    const gradient = stage.querySelector('[data-testid="progress-stage-gradient"]');
    expect(gradient?.getAttribute('data-highlight')).toBe('block');
    expect(gradient?.getAttribute('style')).toContain('linear-gradient');

    fireEvent.pointerMove(stage);
    const tip = await screen.findByTestId('progress-stage-tooltip');
    expect(tip.textContent).toContain('A-roll 拍摄');
    expect(tip.textContent).toContain('A-roll 素材版权待补');
    expect(tip.textContent).toContain('B-roll 素材');
    expect(tip.textContent).toContain('B-roll 甲方素材缺失');
    expect(tip.textContent).not.toContain('实际');

    fireEvent.click(stage);
    const nodes = screen.getByTestId('progress-stage-nodes');
    expect(nodes.className).toContain('auto-fill');
    expect(nodes.className).toContain('minmax');
    expect(nodes.className).toContain('16rem');
    expect(nodes.className).toContain('justify-start');
    expect(nodes.className).toContain('items-start');
    expect(nodes.className).toContain('gap-2');
    expect(nodes.className).not.toContain('md:grid-cols-2');
    const cards = screen.getAllByTestId('progress-stage-node');
    const aRoll = cards.find((card) => card.getAttribute('data-node-id') === 'a_roll');
    const bRoll = cards.find((card) => card.getAttribute('data-node-id') === 'b_roll');
    const ai = cards.find((card) => card.getAttribute('data-node-id') === 'ai_post');
    expect(aRoll?.textContent).toContain('A-roll 拍摄');
    expect(aRoll?.textContent).toContain('阻塞');
    expect(aRoll?.querySelector('[data-testid="progress-blocker"]')?.textContent).toBe(
      'A-roll 素材版权待补',
    );
    expect(aRoll?.textContent).not.toContain('B-roll 甲方素材缺失');
    expect(bRoll?.querySelector('[data-testid="progress-blocker"]')?.textContent).toBe(
      'B-roll 甲方素材缺失',
    );
    expect(ai?.querySelector('[data-testid="progress-blocker"]')).toBeNull();
    expect(screen.queryByTestId('progress-stage-blockers')).toBeNull();
  });

  test('hover on the stage line or its end point opens a tooltip and a mask', async () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!stage) throw new Error('missing copy prep stage');
    fireEvent.pointerMove(stage);
    const tip = await screen.findByTestId('progress-stage-tooltip');
    expect(tip.getAttribute('data-side')).toBe('bottom');
    expect(tip.getAttribute('data-stage-id')).toBe('copy_prep');
    expect(tip.textContent).toContain('文案');
    expect(tip.textContent).toContain('阻塞');
    expect(tip.textContent).toContain('甲方文案批注未清');
    expect(tip.textContent).toContain('预拍摄');
    expect(tip.textContent).toContain('进行中');
    expect(tip.textContent).not.toContain('实际');
    const blockedRow = [...tip.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('文案'),
    );
    expect(blockedRow?.getAttribute('data-status')).toBe('blocked');
    expect(blockedRow?.getAttribute('data-workflow-status')).toBe('blocked');
    expect(stage.getAttribute('data-state')).toMatch(/open/);
    const mask = stage.querySelector('[data-testid="progress-stage-mask"]');
    expect(mask?.getAttribute('data-visible')).toBe('true');
    expect(mask?.className).toContain('opacity-100');
    expect(mask?.className).toContain('bg-foreground/[0.06]');
    expect(mask?.className).not.toContain('bg-black/40');
    const timeline = screen.getByTestId('progress-timeline');
    expect(timeline.textContent).toContain('文案：阻塞');
    expect(timeline.textContent).not.toContain('甲方文案批注未清');

    const endPoint = screen
      .getAllByTestId('progress-point')
      .find((item) => item.getAttribute('data-point-id') === 'outline_locked');
    if (!endPoint) throw new Error('missing outline point');
    fireEvent.pointerMove(endPoint);
    const outlineTip = await screen.findByTestId('progress-stage-tooltip');
    expect(outlineTip.getAttribute('data-stage-id')).toBe('write_outline');
    expect(outlineTip.textContent).toContain('大纲');
    expect(outlineTip.textContent).toContain('完成');
    expect(outlineTip.className).toContain('record-overlay');

    const outlineStage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    if (!outlineStage) throw new Error('missing outline stage');
    fireEvent.pointerLeave(outlineStage);
    await wait(200);
    expect(outlineStage.getAttribute('data-state')).toBe('closed');
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
  });

  test('click expands the child list inside the progress block without summary fields', async () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!stage) throw new Error('missing copy prep stage');
    fireEvent.click(stage);
    expect(stage.getAttribute('aria-expanded')).toBe('true');
    const detail = screen.getByTestId('progress-stage-detail');
    const timeline = screen.getByTestId('progress-timeline');
    expect(
      timeline.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(detail.closest('[data-testid="progress-summary"]')).toBeNull();
    expect(detail.textContent).toContain('文案准备');
    expect(detail.textContent).not.toContain('到手金额');
    expect(detail.textContent).not.toContain('返点金额');
    expect(detail.textContent).not.toContain('尚未发布');
    expect(detail.textContent).not.toContain('任务');
    const rows = screen.getAllByTestId('progress-stage-node');
    expect(rows.map((row) => row.getAttribute('data-node-id'))).toEqual(['copy', 'pre_shoot']);
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['blocked', 'in_progress']);
    expect(rows.map((row) => row.getAttribute('data-workflow-status'))).toEqual([
      'blocked',
      'in_progress',
    ]);
    const copyCard = rows.find((row) => row.getAttribute('data-node-id') === 'copy');
    expect(copyCard?.querySelector('[data-testid="progress-blocker"]')?.textContent).toBe(
      '甲方文案批注未清',
    );
    expect(copyCard?.textContent).toContain('文案');
    expect(screen.queryByTestId('progress-stage-blockers')).toBeNull();
    const motion = screen.getByTestId('progress-stage-detail-body');
    expect(motion.getAttribute('data-motion')).toBe('150ms');
    expect(motion.className).toContain('progress-detail-panel');
    await waitFor(() => {
      expect(motion.getAttribute('data-open')).toBe('true');
    });
  });

  test('hover then click then leave closes the tooltip and keeps the selected mask', async () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    const other = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'production');
    if (!stage || !other) throw new Error('missing stages');

    fireEvent.pointerMove(stage);
    expect(
      (await screen.findByTestId('progress-stage-tooltip')).getAttribute('data-stage-id'),
    ).toBe('copy_prep');
    fireEvent.click(stage);
    expect(stage.getAttribute('data-selected')).toBe('true');
    expect(stage.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerLeave(stage);
    await wait(200);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(stage.getAttribute('data-selected')).toBe('true');
    expect(stage.getAttribute('aria-expanded')).toBe('true');
    const mask = stage.querySelector('[data-testid="progress-stage-mask"]');
    expect(mask?.getAttribute('data-visible')).toBe('true');
    expect(mask?.className).toContain('opacity-100');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('文案准备');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('甲方文案批注未清');

    fireEvent.pointerMove(other);
    const otherTip = await screen.findByTestId('progress-stage-tooltip');
    expect(otherTip.getAttribute('data-stage-id')).toBe('production');
    expect(
      other.querySelector('[data-testid="progress-stage-mask"]')?.getAttribute('data-visible'),
    ).toBe('true');
    expect(stage.getAttribute('data-selected')).toBe('true');
    expect(other.getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('文案准备');
    expect(screen.getByTestId('progress-stage-detail').textContent).not.toContain('拍摄制作');
    fireEvent.pointerLeave(other);
    await wait(200);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(
      other.querySelector('[data-testid="progress-stage-mask"]')?.getAttribute('data-visible'),
    ).toBe('false');
    expect(mask?.getAttribute('data-visible')).toBe('true');

    fireEvent.click(stage);
    expect(stage.getAttribute('aria-expanded')).toBe('false');
    expect(stage.getAttribute('data-selected')).toBe('false');
    expect(mask?.getAttribute('data-visible')).toBe('false');

    fireEvent.click(stage);
    fireEvent.click(other);
    expect(stage.getAttribute('data-selected')).toBe('false');
    expect(other.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('拍摄制作');

    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(screen.getByTestId('progress-stage-detail').getAttribute('data-open')).toBe('false');
    });
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('点击阶段连线或终点');
  });

  test('paints not_applicable children as unfinished', () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const settlement = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'distribution_settlement');
    if (!settlement) throw new Error('missing settlement stage');
    fireEvent.click(settlement);
    const other = screen
      .getAllByTestId('progress-stage-node')
      .find((row) => row.getAttribute('data-node-id') === 'other');
    expect(other?.getAttribute('data-workflow-status')).toBe('not_applicable');
    expect(other?.getAttribute('data-status')).toBe('not_applicable');
    expect(other?.getAttribute('data-demo-status')).toBe('idle');
    expect(other?.textContent).toContain('未完成');
    expect(other?.querySelector('[data-testid="progress-blocker"]')).toBeNull();
  });

  test('puts a missing block reason on the same node card', () => {
    render(
      <ProgressTimeline
        nodes={[
          node('inquiry', '询单', 'completed'),
          node('outline', '大纲', 'completed'),
          node('copy', '文案', 'blocked', '   '),
          node('pre_shoot', '预拍摄', 'completed'),
        ]}
      />,
    );
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!stage) throw new Error('missing copy prep');
    fireEvent.click(stage);
    const copy = screen
      .getAllByTestId('progress-stage-node')
      .find((card) => card.getAttribute('data-node-id') === 'copy');
    expect(copy?.querySelector('[data-testid="progress-blocker"]')?.textContent).toBe(
      '尚未记录原因',
    );
    expect(copy?.textContent).toContain('文案');
    expect(copy?.textContent).toContain('阻塞');
  });
});

describe('LiveProjectWorkflow timeline placement', () => {
  test('puts the timeline, stage detail, and summary above the existing node graph', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith('/workflow')
        ? {
            projectId: PROJECT_ID,
            workflowId: 'a2000001-0001-4001-8001-000000000001',
            templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
            nodes: blockedCopy.map((item) => ({
              id: item.id,
              name: item.name,
              status: item.status,
              kind: item.kind,
              templateSlug: item.templateSlug,
              blockingReason: item.blockingReason,
              plannedAt: null,
              completedAt: null,
              updatedAt: '2026-05-20T12:00:00.000Z',
            })),
            edges: [],
          }
        : asLiveDetail({
            id: PROJECT_ID,
            name: '甲方卡文案确认样例',
            netAmount: '18000.00',
            rebateAmount: '600.00',
            overallStage: 'pre_publish',
            currentStageNames: ['文案', '预拍摄'],
            anyNodeBlocked: true,
            blockingReason: '甲方文案批注未清',
            publish: { published: false, bvid: null, publishedAt: null, publishSource: null },
          });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <div style={{ width: 1280, height: 900 }}>
            <LiveProjectWorkflow projectId={PROJECT_ID} />
          </div>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByRole('heading', { name: '甲方卡文案确认样例' });
    const timeline = await screen.findByTestId('progress-timeline');
    const detail = screen.getByTestId('progress-stage-detail');
    const summary = screen.getByTestId('progress-summary');
    const canvas = await screen.findByTestId('workflow-live-canvas');
    const follows = (earlier: Node, later: Node) =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, summary)).toBe(true);
    expect(follows(summary, timeline)).toBe(true);
    expect(follows(timeline, detail)).toBe(true);
    expect(follows(detail, canvas)).toBe(true);
    expect(screen.queryByTestId('project-video-metrics')).toBeNull();
    expect(summary.className).toContain('grid-cols-1');
    expect(summary.className).toContain('lg:grid-cols-3');
    expect(summary.className).toContain('gap-3');
    const money = screen.getByTestId('progress-summary-money');
    expect(money.className).toContain('rounded-lg');
    expect(money.querySelector('[data-slot="card-content"]')?.className).toContain('px-4');
    expect(money.querySelector('[data-slot="card-content"]')?.className).toContain('py-3');
    expect(money.textContent).toContain('到手金额');
    expect(money.textContent).toContain('¥18,000');
    expect(money.textContent).toContain('返点');
    expect(screen.getByTestId('progress-summary-schedule').textContent).toContain('排期待确认');
    expect(screen.getByTestId('progress-summary-tasks').textContent).toContain('文案、预拍摄');
    expect(screen.getByTestId('progress-summary-tasks').textContent).not.toContain(
      '甲方文案批注未清',
    );
    expect(detail.textContent).not.toContain('到手金额');
    expect(detail.textContent).not.toContain('当前任务');
    expect(canvas.getAttribute('data-live-node-count')).toBe(String(blockedCopy.length));
    await waitFor(() => {
      expect(screen.getAllByTestId('progress-point')).toHaveLength(6);
    });
  });

  test('saves, clears, and surfaces a plan date error from the stage card', async () => {
    const nodes = blockedCopy.map((item) => ({
      ...item,
      updatedAt: '2026-05-20T12:00:00.000000Z',
      plannedAt: item.templateSlug === 'copy' ? '2026-04-01T16:00:00.000Z' : null,
      completedAt: null,
    }));
    let workflowNodes = nodes.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      kind: item.kind,
      templateSlug: item.templateSlug,
      blockingReason: item.blockingReason ?? null,
      plannedAt: item.plannedAt,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
    }));
    const calls: { plannedAt: string | null; expectedUpdatedAt: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          plannedAt: string | null;
          expectedUpdatedAt: string;
        };
        calls.push(body);
        if (body.plannedAt === '2026-04-20') {
          return new Response(
            JSON.stringify({
              error: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
              code: 'stale_write',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        const plannedAt =
          body.plannedAt === null
            ? null
            : new Date(`${body.plannedAt}T00:00:00+08:00`).toISOString();
        workflowNodes = workflowNodes.map((node) =>
          node.id.endsWith('0003')
            ? { ...node, plannedAt, updatedAt: '2026-05-21T12:00:00.000000Z' }
            : node,
        );
        return new Response(
          JSON.stringify({
            projectId: PROJECT_ID,
            node: {
              id: NODE_IDS.copy,
              name: '文案',
              status: 'blocked',
              kind: 'stage',
              updatedAt: '2026-05-21T12:00:00.000000Z',
              statusBeforeBlock: 'in_progress',
              primaryBlockItemId: null,
              plannedAt,
              completedAt: null,
            },
            blockingReason: '甲方文案批注未清',
            pinnedItem: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const body = url.endsWith('/workflow')
        ? {
            projectId: PROJECT_ID,
            workflowId: 'a2000001-0001-4001-8001-000000000001',
            templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
            nodes: workflowNodes,
            edges: [],
          }
        : asLiveDetail({
            id: PROJECT_ID,
            name: '甲方卡文案确认样例',
            netAmount: '18000.00',
            rebateAmount: '600.00',
            overallStage: 'pre_publish',
            currentStageNames: ['文案'],
            anyNodeBlocked: true,
            blockingReason: '甲方文案批注未清',
            publish: { published: false, bvid: null, publishedAt: null, publishSource: null },
          });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LiveProjectWorkflow projectId={PROJECT_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: '甲方卡文案确认样例' });
    const copyStage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!copyStage) throw new Error('missing copy stage');
    fireEvent.click(copyStage);
    expect(screen.queryByTestId('plan-date-copy')).toBeNull();
    expect(screen.queryByTestId('plan-date-save-copy')).toBeNull();
    expect(screen.queryByTestId('plan-date-clear-copy')).toBeNull();
    fireEvent.click(screen.getByTestId('plan-date-edit-copy'));
    const input = await screen.findByTestId('plan-date-copy');
    expect((input as HTMLInputElement).value).toBe('2026-04-02');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('plan-date-save-copy'));
    expect(screen.getByTestId('plan-date-error').textContent).toContain('请选择日期');
    expect(calls).toHaveLength(0);

    fireEvent.change(input, { target: { value: '2026-04-20' } });
    fireEvent.click(screen.getByTestId('plan-date-save-copy'));
    await waitFor(() => {
      expect(screen.getByTestId('plan-date-error').textContent).toContain('并发令牌已过期');
    });

    fireEvent.change(input, { target: { value: '2026-04-09' } });
    fireEvent.click(screen.getByTestId('plan-date-save-copy'));
    await waitFor(() => {
      expect((screen.getByTestId('plan-date-copy') as HTMLInputElement).value).toBe('2026-04-09');
    });
    expect(calls.at(-1)).toMatchObject({
      plannedAt: '2026-04-09',
      expectedUpdatedAt: '2026-05-20T12:00:00.000000Z',
    });

    fireEvent.click(screen.getByTestId('plan-date-clear-copy'));
    await waitFor(() => {
      expect((screen.getByTestId('plan-date-copy') as HTMLInputElement).value).toBe('');
    });
    expect(calls.at(-1)?.plannedAt).toBeNull();
  });

  test('steps a node and its stage from the detail card, and cancel writes nothing', async () => {
    type Row = {
      id: string;
      name: string;
      status: string;
      kind: string;
      templateSlug: string;
      blockingReason: string | null;
      plannedAt: string | null;
      completedAt: string | null;
      updatedAt: string;
    };
    const seeds: Array<[keyof typeof NODE_IDS, string, string]> = [
      ['inquiry', '询单', 'completed'],
      ['outline', '大纲', 'not_reached'],
      ['copy', '文案', 'blocked'],
      ['pre_shoot', '预拍摄', 'not_reached'],
    ];
    const rows: Row[] = seeds.map(([slug, name, status]) => ({
      id: NODE_IDS[slug] ?? '',
      name,
      status,
      kind: 'stage',
      templateSlug: slug,
      blockingReason: slug === 'copy' ? '等甲方' : null,
      plannedAt: null,
      completedAt: null,
      updatedAt: '2026-05-20T12:00:00.000000Z',
    }));
    const posts: string[] = [];
    const gate: { open: (() => void) | null } = { open: null };
    let held = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/step')) {
        posts.push(url);
        const body = JSON.parse(String(init.body)) as { direction: string; force?: boolean };
        if (!held) {
          held = true;
          await new Promise<void>((resolve) => {
            gate.open = resolve;
          });
        }
        const target = rows.find((row) => url.includes(row.id) || url.includes('write_outline'));
        const outline = rows.find((row) => row.templateSlug === 'outline');
        const subject = url.includes('/stages/') ? outline : target;
        if (!subject) {
          return new Response(JSON.stringify({ error: 'missing', code: 'not_found' }), {
            status: 404,
          });
        }
        if (subject.status === 'blocked' && !body.force) {
          return new Response(
            JSON.stringify({
              error: '有开放阻塞，确认后才会强制推进并标记前置完成',
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
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        if (body.direction === 'forward') {
          subject.status =
            subject.status === 'not_reached' || subject.status === 'blocked'
              ? 'in_progress'
              : 'completed';
        } else if (subject.status === 'completed') subject.status = 'in_progress';
        else subject.status = 'not_reached';
        subject.updatedAt = '2026-05-21T12:00:00.000000Z';
        return new Response(
          JSON.stringify({
            projectId: PROJECT_ID,
            overallStage: 'pre_publish',
            nodes: [
              {
                id: subject.id,
                name: subject.name,
                status: subject.status,
                kind: 'stage',
                updatedAt: subject.updatedAt,
                statusBeforeBlock: null,
                primaryBlockItemId: null,
                plannedAt: null,
                completedAt: subject.status === 'completed' ? subject.updatedAt : null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/step')) {
        return new Response(
          JSON.stringify({
            error: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
            code: 'stale_write',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      const payload = url.endsWith('/workflow')
        ? {
            projectId: PROJECT_ID,
            workflowId: 'a2000001-0001-4001-8001-000000000001',
            templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
            nodes: rows,
            edges: [],
          }
        : asLiveDetail({
            id: PROJECT_ID,
            name: '逐级推进样例',
            netAmount: '18000.00',
            rebateAmount: '600.00',
            overallStage: 'pre_publish',
            currentStageNames: [],
            anyNodeBlocked: true,
            blockingReason: '等甲方',
            publish: { published: false, bvid: null, publishedAt: null, publishSource: null },
          });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LiveProjectWorkflow projectId={PROJECT_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: '逐级推进样例' });
    const outlineStage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    if (!outlineStage) throw new Error('missing outline stage');
    fireEvent.click(outlineStage);
    const card = () =>
      screen
        .getAllByTestId('progress-stage-node')
        .find((item) => item.getAttribute('data-node-id') === 'outline');
    expect(card()?.getAttribute('data-status')).toBe('not_reached');
    expect(screen.queryByTestId('plan-date-outline')).toBeNull();
    expect(screen.queryByTestId('plan-date-save-outline')).toBeNull();
    expect(screen.queryByTestId('plan-date-clear-outline')).toBeNull();

    const nodeButton = () => screen.getByTestId('node-step');
    fireEvent.click(nodeButton());
    await waitFor(() => {
      expect(nodeButton().getAttribute('data-pending')).toBe('true');
      if (!gate.open) throw new Error('step request has not started');
    });
    const release = gate.open;
    if (!release) throw new Error('step request has not started');
    release();
    await waitFor(() => {
      expect(card()?.getAttribute('data-status')).toBe('in_progress');
    });
    fireEvent.click(nodeButton());
    await waitFor(() => {
      expect(card()?.getAttribute('data-status')).toBe('completed');
    });
    expect(screen.queryByTestId('node-step')).toBeNull();
    expect(screen.queryByTestId('node-step-hint')).toBeNull();
    expect(screen.getByTestId('node-rollback').textContent).toBe('回退');
    expect(screen.getByTestId('node-rollback').getAttribute('data-variant')).toBe('destructive');
    expect(card()?.textContent).not.toContain('已完成');
    expect(card()?.textContent).not.toContain('下一步');
    fireEvent.click(screen.getByTestId('node-rollback'));
    await waitFor(() => expect(card()?.getAttribute('data-status')).toBe('in_progress'));
    fireEvent.click(screen.getByTestId('node-rollback'));
    await waitFor(() => expect(card()?.getAttribute('data-status')).toBe('not_reached'));

    fireEvent.click(screen.getByTestId('stage-step'));
    await waitFor(() => expect(card()?.getAttribute('data-workflow-status')).toBe('in_progress'));
    fireEvent.click(screen.getByTestId('stage-step'));
    await waitFor(() => expect(card()?.getAttribute('data-workflow-status')).toBe('completed'));
    fireEvent.click(screen.getByTestId('stage-rollback'));
    await waitFor(() => expect(card()?.getAttribute('data-workflow-status')).toBe('in_progress'));

    const copyStage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!copyStage) throw new Error('missing copy stage');
    fireEvent.click(copyStage);
    const before = posts.length;
    const copyStep = screen
      .getAllByTestId('node-step')
      .find((item) => item.getAttribute('data-node-id') === 'copy');
    if (!copyStep) throw new Error('missing copy step');
    fireEvent.click(copyStep);
    const dialog = await screen.findByTestId('step-confirm');
    expect(dialog.textContent).toContain('等甲方');
    expect(dialog.textContent).toContain('关闭阻塞并恢复');
    fireEvent.click(screen.getByTestId('step-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-confirm')).toBeNull());
    expect(posts.length).toBe(before + 1);
    const copyCard = screen
      .getAllByTestId('progress-stage-node')
      .find((item) => item.getAttribute('data-node-id') === 'copy');
    expect(copyCard?.getAttribute('data-status')).toBe('blocked');
  });

  test('a rejected step request stays visible and can be retried', async () => {
    const outline = {
      id: NODE_IDS.outline ?? '',
      name: '大纲',
      status: 'not_reached',
      kind: 'stage',
      templateSlug: 'outline',
      blockingReason: null,
      plannedAt: null,
      completedAt: null,
      updatedAt: '2026-05-20T12:00:00.000000Z',
    };
    let posts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/step')) {
        posts += 1;
        if (posts === 1) throw new TypeError('Failed to fetch');
        outline.status = 'in_progress';
        outline.updatedAt = '2026-05-21T12:00:00.000000Z';
        return new Response(
          JSON.stringify({
            projectId: PROJECT_ID,
            overallStage: 'pre_publish',
            nodes: [
              {
                id: outline.id,
                name: outline.name,
                status: outline.status,
                kind: 'stage',
                updatedAt: outline.updatedAt,
                statusBeforeBlock: null,
                primaryBlockItemId: null,
                plannedAt: null,
                completedAt: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const payload = url.endsWith('/workflow')
        ? {
            projectId: PROJECT_ID,
            workflowId: 'a2000001-0001-4001-8001-000000000001',
            templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
            nodes: [outline],
            edges: [],
          }
        : asLiveDetail({
            id: PROJECT_ID,
            name: '网络失败样例',
            netAmount: null,
            rebateAmount: null,
            overallStage: 'pre_publish',
            currentStageNames: [],
            anyNodeBlocked: false,
            blockingReason: null,
            publish: {
              published: false,
              bvid: null,
              publishedAt: null,
              publishSource: null,
              idempotencyKey: null,
            },
          });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LiveProjectWorkflow projectId={PROJECT_ID} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: '网络失败样例' });
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    if (!stage) throw new Error('missing outline stage');
    fireEvent.click(stage);
    const card = () =>
      screen
        .getAllByTestId('progress-stage-node')
        .find((item) => item.getAttribute('data-node-id') === 'outline');
    fireEvent.click(screen.getByTestId('node-step'));
    const error = await screen.findByTestId('step-error');
    expect(error.textContent).toContain('Failed to fetch');
    expect(card()?.getAttribute('data-status')).toBe('not_reached');
    expect(screen.getByTestId('node-step').hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByTestId('node-step'));
    await waitFor(() => expect(card()?.getAttribute('data-status')).toBe('in_progress'));
    expect(posts).toBe(2);
  });
});

const NOW = new Date('2026-04-10T04:00:00.000Z');

function summaryFacts(overrides: Partial<TimelineProjectFacts> = {}): TimelineProjectFacts {
  return {
    netAmount: '18000.00',
    rebateAmount: '600.00',
    overallStage: 'pre_publish',
    overallStageLabel: '发布前',
    currentTasks: ['文案'],
    published: false,
    publishedAt: null,
    blockingReason: null,
    ...overrides,
  };
}

describe('schedule summary overlay', () => {
  test('shows the next delivery, an overdue mark, and separates plan from actual', async () => {
    render(
      <ProgressSummary
        now={NOW}
        facts={summaryFacts()}
        nodes={[
          node('copy', '文案', 'blocked', '等甲方'),
          node('pre_shoot', '预拍摄', 'not_reached'),
          node('merge', '汇合节点', 'not_reached'),
          node('other', '其他', 'not_applicable'),
        ].map((item) => {
          if (item.templateSlug === 'copy') {
            return {
              ...item,
              plannedAt: new Date('2026-04-01T00:00:00+08:00').toISOString(),
              completedAt: null,
            };
          }
          if (item.templateSlug === 'pre_shoot') {
            return {
              ...item,
              plannedAt: new Date('2026-04-18T14:30:00+08:00').toISOString(),
              completedAt: null,
            };
          }
          return item;
        })}
      />,
    );
    const card = screen.getByTestId('progress-summary-schedule');
    expect(card.textContent).toContain('下一次交付');
    expect(card.textContent).toContain('文案');
    expect(card.textContent).toContain('4月1日');
    expect(card.textContent).toContain('逾期');
    expect(card.textContent).not.toContain('00:00');
    expect(card.textContent).not.toContain('预拍摄');
    fireEvent.pointerEnter(card);
    const overlay = await screen.findByTestId('progress-schedule-overlay');
    expect(overlay.className).toContain('record-overlay');
    expect(overlay.getAttribute('data-side')).toBe('bottom');
    expect(overlay.getAttribute('data-motion')).toBe('140ms');
    expect(overlay.getAttribute('role')).toBe('tooltip');
    expect(overlay.getAttribute('data-interactive')).toBe('false');
    expect(overlay.querySelector('button')).toBeNull();
    expect(Number.parseFloat(overlay.style.width)).toBeLessThanOrEqual(360);
    const copyRow = [...overlay.querySelectorAll('li')].find((row) =>
      row.textContent?.includes('文案'),
    );
    const shootRow = [...overlay.querySelectorAll('li')].find((row) =>
      row.textContent?.includes('预拍摄'),
    );
    expect(copyRow?.textContent).toContain('计划 4月1日');
    expect(copyRow?.textContent).toContain('等甲方');
    expect(copyRow?.textContent).not.toContain('实际');
    expect(shootRow?.textContent).toContain('计划 4月18日 14:30');
    expect(overlay.textContent).not.toContain('汇合节点');
    expect(overlay.textContent).not.toContain('其他');
    expect(overlay.textContent).not.toContain('待安排');
    fireEvent.pointerLeave(card, { relatedTarget: overlay });
    expect(screen.getByTestId('progress-schedule-overlay')).toBeTruthy();
    fireEvent.pointerLeave(overlay, { pointerType: 'mouse', relatedTarget: document.body });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId('progress-schedule-overlay')).toBeNull();
  });

  test('stays open while the pointer crosses the gap, then closes after leaving the overlay', async () => {
    render(
      <ProgressSummary
        now={NOW}
        facts={summaryFacts()}
        nodes={[node('copy', '文案', 'in_progress')]}
      />,
    );
    const card = screen.getByTestId('progress-summary-schedule');
    fireEvent.pointerOver(card, { pointerType: 'mouse', relatedTarget: document.body });
    const overlay = await screen.findByTestId('progress-schedule-overlay');
    fireEvent.pointerOut(card, { pointerType: 'mouse', relatedTarget: document.body });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.getByTestId('progress-schedule-overlay')).toBe(overlay);
    fireEvent.pointerOver(overlay, { pointerType: 'mouse', relatedTarget: document.body });
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(screen.getByTestId('progress-schedule-overlay')).toBe(overlay);
    fireEvent.pointerOut(overlay, { pointerType: 'mouse', relatedTarget: document.body });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.getByTestId('progress-schedule-overlay')).toBe(overlay);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId('progress-schedule-overlay')).toBeNull();
  });

  test('keyboard focus opens the schedule and a coarse pointer toggles it', async () => {
    render(
      <ProgressSummary
        now={NOW}
        facts={summaryFacts()}
        nodes={[node('copy', '文案', 'in_progress')]}
      />,
    );
    const trigger = screen.getByTestId('progress-summary-schedule-trigger');
    expect(screen.getByTestId('progress-summary-schedule').textContent).toContain('排期待确认');
    fireEvent.focus(trigger);
    const overlay = await screen.findByTestId('progress-schedule-overlay');
    expect(overlay.textContent).toContain('待安排：文案');
    fireEvent.blur(trigger);
    await waitFor(() => {
      expect(screen.queryByTestId('progress-schedule-overlay')).toBeNull();
    });

    const original = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    fireEvent.pointerEnter(screen.getByTestId('progress-summary-schedule'), {
      pointerType: 'touch',
    });
    expect(screen.queryByTestId('progress-schedule-overlay')).toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByTestId('progress-schedule-overlay')).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.queryByTestId('progress-schedule-overlay')).toBeNull();
    });
    window.matchMedia = original;
  });

  test('published and closed summaries do not invent the next task', () => {
    const { rerender } = render(
      <ProgressSummary
        now={NOW}
        facts={summaryFacts({
          overallStage: 'published_winding_down',
          overallStageLabel: '已上线，收尾中',
          published: true,
          publishedAt: '2026-05-20T12:00:00.000Z',
        })}
        nodes={[node('publish', '发布', 'completed', null)]}
      />,
    );
    const card = screen.getByTestId('progress-summary-schedule');
    expect(card.textContent).toContain('已发布');
    expect(card.textContent).toContain('5月20日 20:00');
    expect(card.textContent).not.toContain('下一次交付');
    rerender(
      <ProgressSummary
        now={NOW}
        facts={summaryFacts({ overallStage: 'closed', overallStageLabel: '已结案' })}
        nodes={[node('settlement', '结算', 'completed')]}
      />,
    );
    expect(card.textContent).toContain('已结案');
    expect(card.textContent).toContain('无下一交付');
    expect(card.textContent).not.toContain('结算');
  });
});

describe('stage tooltip focus and touch', () => {
  test('keyboard focus opens the tooltip and touch selection does not pin it', async () => {
    render(<ProgressTimeline nodes={blockedCopy} />);
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'copy_prep');
    if (!stage) throw new Error('missing stage');
    fireEvent.focus(stage);
    expect(
      (await screen.findByTestId('progress-stage-tooltip')).getAttribute('data-stage-id'),
    ).toBe('copy_prep');
    fireEvent.blur(stage);
    await waitFor(() => {
      expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    });
    fireEvent.pointerDown(stage, { pointerType: 'touch' });
    fireEvent.pointerEnter(stage, { pointerType: 'touch' });
    fireEvent.click(stage);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(stage.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('文案准备');
    expect(screen.queryByTestId('stage-tooltip-actions')).toBeNull();
  });
});

function stamped(
  slug: string,
  name: string,
  status: string,
  blockingReason: string | null = null,
  extra: Partial<TimelineSourceNode> = {},
): TimelineSourceNode {
  return {
    ...node(slug, name, status, blockingReason),
    updatedAt: '2026-05-20T12:00:00.000Z',
    ...extra,
  };
}

function actionLabels(root: ParentNode, testId: string): string[] {
  return [...root.querySelectorAll(`[data-testid="${testId}"]`)].map(
    (item) => item.textContent ?? '',
  );
}

describe('compact state-exact step actions', () => {
  test('node cards and the stage bar show only the actions for the current state', () => {
    const longName = '预拍摄以及一份很长的节点名称用来确认卡片不会把正文截掉';
    const longReason = '甲方把批注写在第三页边栏，需要逐条改完才能继续，这段原因要完整留在卡片上';
    render(
      <ProgressTimeline
        nodes={[
          stamped('copy', '文案', 'not_reached'),
          stamped('pre_shoot', longName, 'in_progress', null, {
            plannedAt: '2026-04-18T06:30:00.000Z',
          }),
          stamped('manual', '手工', 'completed', null, {
            plannedAt: '2026-04-02T16:00:00.000Z',
            completedAt: '2026-04-09T02:00:00.000Z',
          }),
          stamped('a_roll', 'A-roll 拍摄', 'blocked', longReason),
          stamped('other', '其他', 'not_applicable'),
        ]}
        stepEditor={{
          disabled: false,
          onStep: async () => ({ ok: true }),
          onRefresh: () => undefined,
        }}
        planEditor={{ disabled: false, savingId: null, error: null, onSave: () => undefined }}
      />,
    );

    fireEvent.click(
      screen
        .getAllByTestId('progress-stage')
        .find((item) => item.getAttribute('data-stage-id') === 'copy_prep')!,
    );
    const detail = screen.getByTestId('progress-stage-detail');
    expect(detail.textContent).not.toContain('下一步');
    const cards = within(detail).getAllByTestId('progress-stage-node');
    const byId = (id: string) => {
      const card = cards.find((item) => item.getAttribute('data-node-id') === id);
      if (!card) throw new Error(`missing ${id}`);
      return card;
    };

    const notReached = byId('copy');
    expect(notReached.getAttribute('data-status')).toBe('not_reached');
    expect(actionLabels(notReached, 'node-step')).toEqual(['推进']);
    expect(
      notReached.querySelector('[data-testid="node-step"]')?.getAttribute('data-variant'),
    ).toBe('default');
    expect(notReached.querySelector('[data-testid="node-rollback"]')).toBeNull();
    expect(notReached.querySelector('[data-testid="node-step-actions"]')?.childElementCount).toBe(
      1,
    );
    expect(notReached.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);

    const current = byId('pre_shoot');
    expect(current.getAttribute('data-status')).toBe('in_progress');
    expect(actionLabels(current, 'node-step')).toEqual(['完成']);
    expect(current.querySelector('[data-testid="node-step"]')?.getAttribute('data-variant')).toBe(
      'default',
    );
    expect(actionLabels(current, 'node-rollback')).toEqual(['回退']);
    expect(
      current.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant'),
    ).toBe('secondary');
    expect(current.textContent).toContain(longName);
    expect(current.textContent).toContain('计划');
    expect(current.querySelector('h4')?.className).not.toContain('truncate');
    expect(current.querySelector('[data-testid="plan-date-pre_shoot"]')).toBeNull();

    const done = byId('manual');
    expect(done.getAttribute('data-status')).toBe('completed');
    expect(done.querySelector('[data-testid="node-step"]')).toBeNull();
    expect(done.querySelector('[data-testid="node-step-hint"]')).toBeNull();
    expect(actionLabels(done, 'node-rollback')).toEqual(['回退']);
    expect(done.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant')).toBe(
      'destructive',
    );
    expect(done.querySelector('[data-testid="node-step-actions"]')?.childElementCount).toBe(1);
    expect(done.textContent).not.toContain('已完成');
    expect(done.textContent).not.toContain('下一步');
    expect(done.querySelector('[data-testid="node-completed-at"]')?.textContent).toContain('实际');
    expect(done.textContent).toContain('计划');
    expect(done.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);

    const stageActions = within(detail).getByTestId('stage-step-actions');
    expect(stageActions.getAttribute('data-status')).toBe('in_progress');
    expect(actionLabels(stageActions, 'stage-step')).toEqual(['完成']);
    expect(actionLabels(stageActions, 'stage-rollback')).toEqual(['回退']);
    expect(
      stageActions.querySelector('[data-testid="stage-rollback"]')?.getAttribute('data-variant'),
    ).toBe('secondary');

    fireEvent.click(
      screen
        .getAllByTestId('progress-stage')
        .find((item) => item.getAttribute('data-stage-id') === 'production')!,
    );
    const blocked = within(screen.getByTestId('progress-stage-detail'))
      .getAllByTestId('progress-stage-node')
      .find((item) => item.getAttribute('data-node-id') === 'a_roll');
    expect(blocked?.querySelector('[data-testid="progress-blocker"]')?.textContent).toBe(
      longReason,
    );
    expect(actionLabels(blocked!, 'node-step')).toEqual(['解除阻塞']);
    expect(blocked?.querySelector('[data-testid="node-rollback"]')).toBeNull();
    expect(
      within(screen.getByTestId('progress-stage-detail')).getByTestId('stage-step').textContent,
    ).toBe('处理阻塞并完成');

    fireEvent.click(
      screen
        .getAllByTestId('progress-stage')
        .find((item) => item.getAttribute('data-stage-id') === 'distribution_settlement')!,
    );
    const other = within(screen.getByTestId('progress-stage-detail'))
      .getAllByTestId('progress-stage-node')
      .find((item) => item.getAttribute('data-node-id') === 'other');
    expect(other?.getAttribute('data-status')).toBe('not_applicable');
    expect(other?.querySelector('[data-testid="node-step"]')).toBeNull();
    expect(actionLabels(other!, 'node-rollback')).toEqual(['回退']);
    expect(
      other?.querySelector('[data-testid="node-rollback"]')?.getAttribute('data-variant'),
    ).toBe('ghost');
  });

  test('stage bars for not reached and completed do not keep a forward slot', () => {
    const editor = {
      disabled: false,
      onStep: async (): Promise<StepResult> => ({ ok: true }),
      onRefresh: () => undefined,
    };
    const { rerender } = render(
      <ProgressTimeline nodes={[stamped('outline', '大纲', 'not_reached')]} stepEditor={editor} />,
    );
    const open = () => {
      const stage = screen
        .getAllByTestId('progress-stage')
        .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
      if (!stage) throw new Error('missing outline');
      if (stage.getAttribute('data-selected') !== 'true') fireEvent.click(stage);
    };
    open();
    let actions = within(screen.getByTestId('progress-stage-detail')).getByTestId(
      'stage-step-actions',
    );
    expect(actions.getAttribute('data-status')).toBe('not_reached');
    expect(actionLabels(actions, 'stage-step')).toEqual(['推进']);
    expect(actions.querySelector('[data-testid="stage-rollback"]')).toBeNull();
    expect(actions.childElementCount).toBe(1);

    rerender(
      <ProgressTimeline nodes={[stamped('outline', '大纲', 'completed')]} stepEditor={editor} />,
    );
    open();
    actions = within(screen.getByTestId('progress-stage-detail')).getByTestId('stage-step-actions');
    expect(actions.getAttribute('data-status')).toBe('completed');
    expect(actions.querySelector('[data-testid="stage-step"]')).toBeNull();
    expect(actionLabels(actions, 'stage-rollback')).toEqual(['回退']);
    expect(
      actions.querySelector('[data-testid="stage-rollback"]')?.getAttribute('data-variant'),
    ).toBe('destructive');
    expect(screen.getByTestId('progress-stage-detail').textContent).not.toContain('下一步');
  });

  test('forward twice and reverse twice follow the node and stage attributes', async () => {
    const calls: StepCall[] = [];
    function Harness() {
      const [nodes, setNodes] = useState([stamped('outline', '大纲', 'not_reached')]);
      return (
        <ProgressTimeline
          nodes={nodes}
          stepEditor={{
            disabled: false,
            onRefresh: () => undefined,
            onStep: async (call) => {
              calls.push(call);
              setNodes((current) =>
                current.map((item) => {
                  const next =
                    call.direction === 'forward'
                      ? item.status === 'not_reached'
                        ? 'in_progress'
                        : 'completed'
                      : item.status === 'completed'
                        ? 'in_progress'
                        : 'not_reached';
                  return { ...item, status: next, updatedAt: '2026-05-21T12:00:00.000Z' };
                }),
              );
              return { ok: true };
            },
          }}
        />
      );
    }
    render(<Harness />);
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    if (!stage) throw new Error('missing outline');
    fireEvent.click(stage);
    const card = () =>
      within(screen.getByTestId('progress-stage-detail')).getByTestId('progress-stage-node');
    const detailActions = () =>
      within(screen.getByTestId('progress-stage-detail')).getByTestId('node-step-actions');

    fireEvent.click(within(detailActions()).getByTestId('node-step'));
    await waitFor(() => expect(card().getAttribute('data-status')).toBe('in_progress'));
    expect(actionLabels(detailActions(), 'node-step')).toEqual(['完成']);
    expect(actionLabels(detailActions(), 'node-rollback')).toEqual(['回退']);
    fireEvent.click(within(detailActions()).getByTestId('node-step'));
    await waitFor(() => expect(card().getAttribute('data-status')).toBe('completed'));
    expect(card().querySelector('[data-testid="node-step"]')).toBeNull();
    expect(card().textContent).not.toContain('下一步');
    fireEvent.click(within(detailActions()).getByTestId('node-rollback'));
    await waitFor(() => expect(card().getAttribute('data-status')).toBe('in_progress'));
    fireEvent.click(within(detailActions()).getByTestId('node-rollback'));
    await waitFor(() => expect(card().getAttribute('data-status')).toBe('not_reached'));
    expect(actionLabels(detailActions(), 'node-step')).toEqual(['推进']);

    const stageActions = () =>
      within(screen.getByTestId('progress-stage-detail')).getByTestId('stage-step-actions');
    fireEvent.click(within(stageActions()).getByTestId('stage-step'));
    await waitFor(() => expect(card().getAttribute('data-workflow-status')).toBe('in_progress'));
    fireEvent.click(within(stageActions()).getByTestId('stage-step'));
    await waitFor(() => expect(card().getAttribute('data-workflow-status')).toBe('completed'));
    expect(stageActions().querySelector('[data-testid="stage-step"]')).toBeNull();
    fireEvent.click(within(stageActions()).getByTestId('stage-rollback'));
    await waitFor(() => expect(card().getAttribute('data-workflow-status')).toBe('in_progress'));
    fireEvent.click(within(stageActions()).getByTestId('stage-rollback'));
    await waitFor(() => expect(card().getAttribute('data-workflow-status')).toBe('not_reached'));
    expect(calls.map((call) => `${call.kind}:${call.direction}`)).toEqual([
      'node:forward',
      'node:forward',
      'node:rollback',
      'node:rollback',
      'stage:forward',
      'stage:forward',
      'stage:rollback',
      'stage:rollback',
    ]);
  });
});

describe('stage tooltip quick actions', () => {
  function stageButton(id: string) {
    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === id);
    if (!stage) throw new Error(`missing ${id}`);
    return stage;
  }

  test('tooltip actions call the stage, survive the gap, and leave another detail selected', async () => {
    const calls: StepCall[] = [];
    const gate: { open: (() => void) | null } = { open: null };
    function Harness() {
      const [nodes, setNodes] = useState([
        stamped('outline', '大纲', 'completed'),
        stamped('copy', '文案', 'not_reached'),
        stamped('pre_shoot', '预拍摄', 'not_reached'),
      ]);
      return (
        <ProgressTimeline
          nodes={nodes}
          stepEditor={{
            disabled: false,
            onRefresh: () => undefined,
            onStep: async (call) => {
              calls.push(call);
              if (calls.length === 1) {
                await new Promise<void>((resolve) => {
                  gate.open = resolve;
                });
              }
              setNodes((current) =>
                current.map((item) =>
                  item.templateSlug === 'copy' || item.templateSlug === 'pre_shoot'
                    ? {
                        ...item,
                        status:
                          call.direction === 'rollback'
                            ? 'not_reached'
                            : item.status === 'not_reached'
                              ? 'in_progress'
                              : 'completed',
                      }
                    : item,
                ),
              );
              return { ok: true };
            },
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(stageButton('write_outline'));
    expect(stageButton('write_outline').getAttribute('data-selected')).toBe('true');
    fireEvent.pointerMove(stageButton('copy_prep'));
    const tip = await screen.findByTestId('progress-stage-tooltip');
    expect(tip.getAttribute('role')).toBe('dialog');
    expect(tip.getAttribute('data-interactive')).toBe('true');
    expect(tip.getAttribute('data-stage-id')).toBe('copy_prep');
    const forward = within(tip).getByTestId('stage-step');
    expect(forward.textContent).toBe('推进');
    fireEvent.pointerLeave(stageButton('copy_prep'), { relatedTarget: document.body });
    await wait(40);
    expect(screen.getByTestId('progress-stage-tooltip')).toBe(tip);
    fireEvent.pointerEnter(tip);
    await wait(180);
    expect(screen.getByTestId('progress-stage-tooltip')).toBe(tip);

    fireEvent.click(forward);
    fireEvent.click(forward);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'stage',
      stageId: 'copy_prep',
      direction: 'forward',
      force: false,
    });
    expect(stageButton('write_outline').getAttribute('data-selected')).toBe('true');
    expect(stageButton('copy_prep').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('写大纲');
    expect(screen.getByTestId('progress-stage-detail').textContent).not.toContain('文案准备');
    expect(forward.getAttribute('data-pending')).toBe('true');
    if (!gate.open) throw new Error('step did not start');
    gate.open();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('progress-stage-tooltip')).getByTestId('stage-step').textContent,
      ).toBe('完成'),
    );
    expect(
      within(screen.getByTestId('progress-stage-tooltip')).getByTestId('stage-rollback')
        .textContent,
    ).toBe('回退');
    expect(stageButton('write_outline').getAttribute('data-selected')).toBe('true');

    fireEvent.click(
      within(screen.getByTestId('progress-stage-tooltip')).getByTestId('stage-rollback'),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('progress-stage-tooltip')).getByTestId('stage-step').textContent,
      ).toBe('推进'),
    );
    expect(calls.at(-1)).toMatchObject({ direction: 'rollback', stageId: 'copy_prep' });
    expect(stageButton('write_outline').getAttribute('data-selected')).toBe('true');
  });

  test('keyboard reaches the tooltip action and escape writes nothing', async () => {
    const calls: StepCall[] = [];
    render(
      <ProgressTimeline
        nodes={[stamped('outline', '大纲', 'not_reached')]}
        stepEditor={{
          disabled: false,
          onRefresh: () => undefined,
          onStep: async (call) => {
            calls.push(call);
            return { ok: true };
          },
        }}
      />,
    );
    const stage = stageButton('write_outline');
    fireEvent.focus(stage);
    const tip = await screen.findByTestId('progress-stage-tooltip');
    expect(tip.getAttribute('role')).toBe('dialog');
    fireEvent.keyDown(stage, { key: 'Tab' });
    const button = within(tip).getByTestId('stage-step');
    expect(document.activeElement).toBe(button);
    button.click();
    expect(calls).toHaveLength(1);
    fireEvent.keyDown(button, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(stage.getAttribute('data-selected')).toBe('false');
  });

  test('a blocked tooltip confirmation can be cancelled with no second write, and an error outlives the tooltip', async () => {
    const calls: StepCall[] = [];
    let mode: 'confirm' | 'error' | 'ok' = 'confirm';
    function Harness() {
      const [nodes, setNodes] = useState([
        stamped('a_roll', 'A-roll 拍摄', 'blocked', '素材缺失'),
        stamped('b_roll', 'B-roll 素材', 'not_reached'),
        stamped('ai_post', 'AI 后期', 'not_reached'),
      ]);
      return (
        <ProgressTimeline
          nodes={nodes}
          stepEditor={{
            disabled: false,
            onRefresh: () => undefined,
            onStep: async (call) => {
              calls.push(call);
              if (mode === 'confirm' && !call.force) {
                const result: StepResult = {
                  ok: false,
                  message: '有开放阻塞，确认后才会关闭',
                  code: 'confirmation_required',
                  blocks: [
                    { nodeId: NODE_IDS.a_roll ?? '', nodeName: 'A-roll 拍摄', reason: '素材缺失' },
                  ],
                  effects: [
                    {
                      nodeId: NODE_IDS.a_roll ?? '',
                      nodeName: 'A-roll 拍摄',
                      from: 'blocked',
                      to: 'in_progress',
                    },
                  ],
                  successors: [],
                };
                return result;
              }
              if (mode === 'error') {
                throw new Error('网络异常，请重试');
              }
              setNodes((current) =>
                current.map((item) =>
                  item.templateSlug === 'a_roll'
                    ? { ...item, status: 'in_progress', blockingReason: null }
                    : item,
                ),
              );
              return { ok: true };
            },
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(stageButton('write_outline'));
    fireEvent.pointerMove(stageButton('production'));
    const tip = await screen.findByTestId('progress-stage-tooltip');
    fireEvent.click(within(tip).getByTestId('stage-step'));
    const dialog = await screen.findByTestId('step-confirm');
    expect(dialog.textContent).toContain('素材缺失');
    expect(dialog.textContent).toContain('关闭阻塞并恢复');
    fireEvent.pointerLeave(stageButton('production'), { relatedTarget: document.body });
    fireEvent.pointerLeave(tip, { relatedTarget: document.body });
    await wait(200);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(screen.getByTestId('step-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('step-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('step-confirm')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.force).toBe(false);
    expect(stageButton('write_outline').getAttribute('data-selected')).toBe('true');

    mode = 'error';
    fireEvent.pointerMove(stageButton('production'));
    fireEvent.click(
      within(await screen.findByTestId('progress-stage-tooltip')).getByTestId('stage-step'),
    );
    const error = await screen.findByTestId('step-error');
    expect(error.textContent).toContain('网络异常，请重试');
    fireEvent.pointerLeave(stageButton('production'), { relatedTarget: document.body });
    const openTip = screen.queryByTestId('progress-stage-tooltip');
    if (openTip) fireEvent.pointerLeave(openTip, { relatedTarget: document.body });
    await wait(200);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(screen.getByTestId('step-error').textContent).toContain('网络异常，请重试');

    mode = 'ok';
    fireEvent.pointerMove(stageButton('production'));
    const retry = within(await screen.findByTestId('progress-stage-tooltip')).getByTestId(
      'stage-step',
    );
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(calls.filter((call) => call.force === false).length).toBe(3));
    expect(screen.queryByTestId('step-error')).toBeNull();
  });

  test('native tooltip activation does not pin the overlay after focus and pointer both leave', async () => {
    const calls: StepCall[] = [];
    render(
      <ProgressTimeline
        nodes={[
          stamped('outline', '大纲', 'not_reached'),
          stamped('review', '审核', 'completed'),
          stamped('publish', '发布', 'not_reached'),
          stamped('distribution', '全平台分发', 'not_reached'),
          stamped('settlement', '结算', 'not_reached'),
        ]}
        stepEditor={{
          disabled: false,
          onRefresh: () => undefined,
          recordedPublish: {
            bvid: 'BV1xx411c7mD',
            publishedAt: '2026-05-20T12:00:00.000Z',
            idempotencyKey: 'publish-key-1',
          },
          onStep: async (call) => {
            calls.push(call);
            if (call.stageId === 'distribution_settlement' && call.publish == null) {
              const refused: StepResult = {
                ok: false,
                message: '发布节点要补上已有记录',
                code: 'publish_required',
                blocks: [],
                effects: [],
                successors: [],
              };
              return refused;
            }
            return { ok: true };
          },
        }}
      />,
    );
    const review = stageButton('client_review');
    const settlement = stageButton('distribution_settlement');
    fireEvent.pointerDown(review, { pointerType: 'mouse' });
    fireEvent.click(review);
    expect(review.getAttribute('data-selected')).toBe('true');

    fireEvent.pointerMove(settlement);
    const tip = await screen.findByTestId('progress-stage-tooltip');
    expect(tip.getAttribute('data-stage-id')).toBe('distribution_settlement');
    fireEvent.pointerLeave(settlement, { relatedTarget: document.body });
    await wait(40);
    expect(screen.getByTestId('progress-stage-tooltip')).toBe(tip);
    fireEvent.pointerEnter(tip);

    const forward = within(tip).getByTestId('stage-step');
    expect(forward.textContent).toBe('推进');
    await act(async () => {
      forward.focus();
      forward.click();
    });
    expect(document.activeElement).toBe(forward);

    const dialog = await screen.findByTestId('step-publish');
    expect((within(dialog).getByTestId('step-publish-bvid') as HTMLInputElement).value).toBe(
      'BV1xx411c7mD',
    );
    await act(async () => {
      screen.getByTestId('step-publish-cancel').click();
    });
    await waitFor(() => expect(screen.queryByTestId('step-publish')).toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.publish ?? null).toBeNull();
    expect(screen.getByTestId('progress-stage-tooltip').getAttribute('data-stage-id')).toBe(
      'distribution_settlement',
    );
    expect(review.getAttribute('data-selected')).toBe('true');

    const openTip = screen.getByTestId('progress-stage-tooltip');
    fireEvent.pointerLeave(openTip, { relatedTarget: document.body });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await wait(450);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(settlement.getAttribute('data-state')).toBe('closed');
    expect(review.getAttribute('data-selected')).toBe('true');
    expect(review.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByTestId('progress-stage-detail').textContent).toContain('甲方审核');
    expect(screen.getByTestId('progress-stage-detail').textContent).not.toContain('分发结算');
    expect(calls).toHaveLength(1);

    fireEvent.pointerMove(stageButton('write_outline'));
    const outlineTip = await screen.findByTestId('progress-stage-tooltip');
    const outlineForward = within(outlineTip).getByTestId('stage-step');
    outlineForward.focus();
    outlineForward.click();
    expect(calls.at(-1)).toMatchObject({
      kind: 'stage',
      stageId: 'write_outline',
      direction: 'forward',
    });
    fireEvent.pointerLeave(outlineTip, { relatedTarget: document.body });
    await wait(40);
    expect(screen.getByTestId('progress-stage-tooltip').getAttribute('data-stage-id')).toBe(
      'write_outline',
    );
    expect(document.activeElement).toBe(outlineForward);
    fireEvent.blur(outlineForward, { relatedTarget: document.body });
    await wait(450);
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(stageButton('write_outline').getAttribute('data-state')).toBe('closed');
    expect(review.getAttribute('data-selected')).toBe('true');

    const outline = stageButton('write_outline');
    fireEvent.focus(outline);
    fireEvent.keyDown(outline, { key: 'Tab' });
    const keyed = within(screen.getByTestId('progress-stage-tooltip')).getByTestId('stage-step');
    expect(document.activeElement).toBe(keyed);
    fireEvent.keyDown(keyed, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(outline);
    expect(screen.getByTestId('progress-stage-tooltip')).toBeTruthy();
    fireEvent.blur(outline, { relatedTarget: document.body });
    expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    expect(calls.filter((call) => call.stageId === 'write_outline')).toHaveLength(1);
  });
});
