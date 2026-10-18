import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { LiveProjectWorkflow } from './live-project-workflow';
import { ProgressTimeline } from './progress-timeline-view';
import type { TimelineSourceNode } from '../progress-timeline';

const originalFetch = globalThis.fetch;

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
    expect(tip.textContent).toContain('A-roll 拍摄：阻塞（A-roll 素材版权待补）');
    expect(tip.textContent).toContain('B-roll 素材：阻塞（B-roll 甲方素材缺失）');

    fireEvent.click(stage);
    const nodes = screen.getByTestId('progress-stage-nodes');
    expect(nodes.className).toContain('grid-cols-1');
    expect(nodes.className).toContain('md:grid-cols-2');
    expect(nodes.className).toContain('xl:grid-cols-3');
    expect(nodes.className).toContain('gap-3');
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
    expect(tip.textContent).toContain('文案：阻塞（甲方文案批注未清）');
    expect(tip.textContent).toContain('预拍摄：进行中');
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
    expect(outlineTip.textContent).toContain('大纲：完成');

    const outlineStage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'write_outline');
    if (!outlineStage) throw new Error('missing outline stage');
    fireEvent.pointerLeave(outlineStage);
    await waitFor(() => {
      expect(outlineStage.getAttribute('data-state')).toBe('closed');
      expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    });
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
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['blocked', 'active']);
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
    await waitFor(() => {
      expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    });
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
    await waitFor(() => {
      expect(screen.queryByTestId('progress-stage-tooltip')).toBeNull();
    });
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
    expect(other?.getAttribute('data-status')).toBe('idle');
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
              updatedAt: '2026-05-20T12:00:00.000Z',
            })),
            edges: [],
          }
        : {
            id: PROJECT_ID,
            name: '甲方卡文案确认样例',
            netAmount: '18000.00',
            rebateAmount: '600.00',
            overallStage: 'pre_publish',
            currentStageNames: ['文案', '预拍摄'],
            anyNodeBlocked: true,
            blockingReason: '甲方文案批注未清',
            publish: { published: false, bvid: null, publishedAt: null, publishSource: null },
          };
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
    expect(screen.getByTestId('progress-summary-schedule').textContent).toContain('尚未发布');
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
});
