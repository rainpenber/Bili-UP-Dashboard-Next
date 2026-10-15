import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID } from '../workflow-graph-junctions';
import { layoutWorkflowGraph } from '../workflow-graph-flow-layout';
import {
  pointViolatesEdgeCard,
  samplePathPoints,
  type Rect,
} from '../workflow-graph-edge-geometry';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

setDefaultTimeout(30_000);

afterEach(() => cleanup());

function parseViewportTransform(container: HTMLElement): {
  tx: number;
  ty: number;
  scale: number;
} {
  const vp = container.querySelector('.react-flow__viewport');
  const raw = vp?.getAttribute('style') ?? '';
  const transform = raw.match(/transform:\s*([^;]+)/)?.[1] ?? '';
  const scale = parseFloat(transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1');
  const translate = transform.match(/translate\(([^)]+)\)/)?.[1] ?? '0px, 0px';
  const [txRaw, tyRaw] = translate.split(',');
  const tx = parseFloat(txRaw ?? '0');
  const ty = parseFloat(tyRaw ?? '0');
  return { tx, ty, scale };
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

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
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

  test('no edge path crosses unrelated cards (nev-spring, board-prop)', async () => {
    for (const id of ['proj-nev-spring', 'proj-board-prop'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const { container } = render(
        <div style={{ width: 1440, height: 1250 }}>
          <WorkflowGraphReadonly graph={project.workflow} />
        </div>,
      );
      await waitForGraphReady(container);
      const violations = countEdgeCardViolations(container);
      expect(violations).toBe(0);
    }
  });

  test('viewport transform unchanged after selecting a node', async () => {
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
      <div style={{ width: 1440, height: 1250 }}>
        <Harness />
      </div>,
    );
    await waitForGraphReady(container);
    const before = parseViewportTransform(container);
    const outline = container.querySelector('[data-workflow-node="outline"]')!;
    await act(async () => {
      fireEvent.click(outline);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="workflow-node-actions"]')).toBeTruthy();
    });
    const after = parseViewportTransform(container);
    expect(after.scale).toBeCloseTo(before.scale, 5);
    expect(after.tx).toBeCloseTo(before.tx, 1);
    expect(after.ty).toBeCloseTo(before.ty, 1);
  });
});
