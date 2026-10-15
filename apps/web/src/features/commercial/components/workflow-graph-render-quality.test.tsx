import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID } from '../workflow-graph-junctions';
import {
  countCurveCommands,
  countEdgeEdgeCrossings,
  countNonOrthogonalSegments,
  pointViolatesEdgeCard,
  samplePathPoints,
  type Rect,
} from '../workflow-graph-edge-geometry';
import { buildRoutedEdgeData } from '../workflow-graph-edge-routing';
import { layoutWorkflowGraph, type WorkflowGraphLayout } from '../workflow-graph-flow-layout';
import type { WorkflowGraph } from '../types';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

setDefaultTimeout(30_000);

afterEach(() => cleanup());

function viewportTransformRaw(container: HTMLElement): string {
  const vp = container.querySelector('.react-flow__viewport');
  const raw = vp?.getAttribute('style') ?? '';
  return raw.match(/transform:\s*([^;]+)/)?.[1]?.trim() ?? '';
}

function parseViewportTransform(container: HTMLElement): {
  tx: number;
  ty: number;
  scale: number;
} {
  const transform = viewportTransformRaw(container);
  const scale = parseFloat(transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1');
  const translate = transform.match(/translate\(([^)]+)\)/)?.[1] ?? '0px, 0px';
  const [txRaw, tyRaw] = translate.split(',');
  return { tx: parseFloat(txRaw ?? '0'), ty: parseFloat(tyRaw ?? '0'), scale };
}

function toScreen(point: { x: number; y: number }, vp: { tx: number; ty: number; scale: number }) {
  return { x: point.x * vp.scale + vp.tx, y: point.y * vp.scale + vp.ty };
}

function cardRects(container: HTMLElement): Map<string, Rect> {
  const vpEl = container.querySelector('.react-flow__viewport')!;
  const vpBox = vpEl.getBoundingClientRect();
  const out = new Map<string, Rect>();
  for (const card of container.querySelectorAll('[data-workflow-node]')) {
    const id = card.getAttribute('data-workflow-node')!;
    const r = card.getBoundingClientRect();
    out.set(id, {
      left: r.left - vpBox.left,
      top: r.top - vpBox.top,
      right: r.right - vpBox.left,
      bottom: r.bottom - vpBox.top,
    });
  }
  return out;
}

function collectRenderedPaths(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.react-flow__edge-path')]
    .map((p) => p.getAttribute('d') ?? '')
    .filter((d) => d.length > 4);
}

function countEdgeCardViolations(container: HTMLElement): number {
  const vp = parseViewportTransform(container);
  const cards = cardRects(container);
  const paths = container.querySelectorAll('.react-flow__edge-path');
  let violations = 0;
  for (const path of paths) {
    const g = path.closest('g');
    const label = g?.getAttribute('aria-label') ?? '';
    const m = /^Edge from (.+) to (.+)$/.exec(label);
    if (!m) continue;
    const sourceId = m[1]!;
    const targetId = m[2]!;
    const sourceRect = cards.get(sourceId);
    const targetRect = cards.get(targetId);
    if (!sourceRect || !targetRect) continue;
    const d = path.getAttribute('d') ?? '';
    for (const p of samplePathPoints(d, 12)) {
      const screen = toScreen(p, vp);
      for (const [id, rect] of cards) {
        if (id === sourceId || id === targetId) continue;
        if (pointViolatesEdgeCard(screen, rect, sourceRect, targetRect)) {
          violations += 1;
          break;
        }
      }
    }
  }
  return violations;
}

function workflowModelIds(graph: WorkflowGraph): string[] {
  const ids: string[] = [];
  for (const step of graph.steps) {
    if (step.kind === 'serial') ids.push(step.node.id);
    else ids.push(...step.nodes.map((n) => n.id));
  }
  return ids;
}

/** Incident centerlines on the bus, computed without the marker helper. */
function expectedMeetingPoints(layout: WorkflowGraphLayout): { x: number; y: number }[] {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const dots: { x: number; y: number }[] = [];
  for (const junctionId of [JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID]) {
    const sources: string[] = [];
    const targets: string[] = [];
    for (const e of layout.edges) {
      if (e.to === junctionId) sources.push(e.from);
      if (e.from === junctionId) targets.push(e.to);
    }
    if (sources.length === 0 || targets.length === 0) continue;
    const aboveBottom = Math.max(
      ...sources.map((id) => {
        const n = byId.get(id)!;
        return n.y + n.height;
      }),
    );
    const belowTop = Math.min(...targets.map((id) => byId.get(id)!.y));
    const y = aboveBottom + (belowTop - aboveBottom) / 2;
    const xs = new Set(
      [...sources, ...targets].map((id) => {
        const n = byId.get(id)!;
        return n.x + n.width / 2;
      }),
    );
    for (const x of [...xs].sort((a, b) => a - b)) dots.push({ x, y });
  }
  return dots;
}

function nodeTranslate(el: HTMLElement): { x: number; y: number } | null {
  const style = el.getAttribute('style') ?? '';
  const m = style.match(/translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/);
  if (!m) return null;
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

function elementPx(el: HTMLElement, axis: 'width' | 'height'): number {
  const raw = el.style[axis];
  const fromStyle = raw ? parseFloat(raw) : NaN;
  if (Number.isFinite(fromStyle) && fromStyle > 0) return fromStyle;
  return axis === 'width' ? el.offsetWidth : el.offsetHeight;
}

function isJunctionAccent(color: string): boolean {
  const c = color.replace(/\s+/g, '').toLowerCase();
  return c === '#ff6603' || c === 'rgb(255,102,3)' || c === 'rgba(255,102,3,1)';
}

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
  await waitFor(
    () => {
      expect(viewportTransformRaw(container).length).toBeGreaterThan(5);
    },
    { timeout: 15000 },
  );
}

describe('Workflow graph render quality', () => {
  test('junction dots: prep-prod and pub-wind only', () => {
    for (const id of ['proj-nev-spring', 'proj-board-prop'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      expect(layout.junctions.map((j) => j.id).sort()).toEqual(
        [JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID].sort(),
      );
    }
  });

  test('no edge crosses another edge or unrelated cards', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live', 'proj-board-prop'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      const layoutPaths = [...buildRoutedEdgeData(layout).values()]
        .map((m) => m.path!)
        .filter(Boolean);
      expect(countCurveCommands(layoutPaths)).toBe(0);
      expect(countNonOrthogonalSegments(layoutPaths)).toBe(0);
      expect(countEdgeEdgeCrossings(layoutPaths)).toBe(0);

      const { container } = render(
        <div style={{ width: 1440, height: 1250 }}>
          <WorkflowGraphReadonly graph={project.workflow} />
        </div>,
      );
      await waitForGraphReady(container);
      const paths = collectRenderedPaths(container);
      expect(countEdgeCardViolations(container)).toBe(0);
      expect(countCurveCommands(paths)).toBe(0);
      expect(countEdgeEdgeCrossings(paths)).toBe(0);
      expect(countNonOrthogonalSegments(paths)).toBe(0);
      cleanup();
    }
  });

  test('junction markers are 10px accent dots at meeting points', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live', 'proj-board-prop'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      const expected = expectedMeetingPoints(layout);
      expect(workflowModelIds(project.workflow).some((nodeId) => nodeId.includes('junction'))).toBe(
        false,
      );
      expect(
        layout.nodes.some((n) => n.id.includes('junction') || n.id.startsWith('display-dot')),
      ).toBe(false);

      const { container } = render(
        <div style={{ width: 1440, height: 1250 }}>
          <WorkflowGraphReadonly graph={project.workflow} />
        </div>,
      );
      await waitForGraphReady(container);

      const dots = [...container.querySelectorAll('[data-workflow-junction]')];
      expect(dots).toHaveLength(expected.length);

      const centers: { x: number; y: number }[] = [];
      for (const dot of dots) {
        const marker = dot.closest('.react-flow__node') as HTMLElement | null;
        expect(marker).toBeTruthy();
        const host = marker!;
        const width = elementPx(host, 'width');
        const height = elementPx(host, 'height');
        expect(width).toBeLessThanOrEqual(20);
        expect(height).toBeLessThanOrEqual(20);
        expect(width).toBeGreaterThanOrEqual(8);
        expect(height).toBeGreaterThanOrEqual(8);
        expect(isJunctionAccent(getComputedStyle(dot).backgroundColor)).toBe(true);
        const pos = nodeTranslate(host);
        expect(pos).toBeTruthy();
        centers.push({ x: pos!.x + width / 2, y: pos!.y + height / 2 });
      }

      for (const node of container.querySelectorAll('.react-flow__node')) {
        const nodeId = node.getAttribute('data-id') ?? '';
        if (!nodeId.includes('junction') && !nodeId.startsWith('display-dot')) continue;
        const host = node as HTMLElement;
        expect(elementPx(host, 'width')).toBeLessThanOrEqual(20);
        expect(elementPx(host, 'height')).toBeLessThanOrEqual(20);
      }

      for (const point of expected) {
        const hit = centers.some(
          (c) => Math.abs(c.x - point.x) <= 1 && Math.abs(c.y - point.y) <= 1,
        );
        expect(hit).toBe(true);
      }
      cleanup();
    }
  });

  test('viewport transform byte-identical after selecting a node', async () => {
    function Harness() {
      const project = commercialProjectsMock.find((p) => p.id === 'proj-nev-spring')!;
      const editor = useProjectWorkflowEditor(project.workflow);
      return (
        <div data-testid="harness">
          <WorkflowGraphEditor editor={editor} />
        </div>
      );
    }
    const { container } = render(
      <div style={{ width: 861, height: 718 }}>
        <Harness />
      </div>,
    );
    await waitForGraphReady(container);
    const before = viewportTransformRaw(container);
    const outline = container.querySelector('[data-workflow-node="outline"]')!;
    await act(async () => {
      fireEvent.click(outline);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="workflow-node-actions"]')).toBeTruthy();
    });
    const after = viewportTransformRaw(container);
    expect(after).toBe(before);
  });
});
