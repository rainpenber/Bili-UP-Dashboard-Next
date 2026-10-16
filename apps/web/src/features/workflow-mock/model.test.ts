import { describe, expect, test } from 'bun:test';
import { layoutWithDagre } from './layout';
import {
  addStageNode,
  applyPositions,
  buildMockVersions,
  commitDrag,
  commitHistory,
  connectNodes,
  redoHistory,
  removeElements,
  undoHistory,
  type HistoryState,
} from './model';

const versions = buildMockVersions(layoutWithDagre);
const v1 = versions[0]!.graph;
const v2 = versions[1]!.graph;
const v3 = versions[2]!.graph;

describe('workflow mock graphs', () => {
  test('lays versions out and keeps merge nodes as anchors', () => {
    expect(versions.map((version) => version.label)).toEqual(['V1', 'V2', 'V3']);
    const merges = v1.nodes.filter((node) => node.kind === 'merge');
    expect(merges.map((node) => node.id).sort()).toEqual(['merge-prep', 'merge-pub']);
    expect(merges.every((node) => node.name === '')).toBe(true);
    expect(v1.nodes.some((node) => node.kind === 'stage' && node.x !== 0)).toBe(true);
    expect(v2.nodes.some((node) => node.name === '样片')).toBe(true);
    expect(v3.nodes.some((node) => node.name === '外拍')).toBe(true);
    expect(v3.nodes.some((node) => node.name === 'AI 后期' || node.name === '其他')).toBe(false);
  });

  test('connects only between stage nodes and rejects cycles', () => {
    expect(connectNodes(v1, 'inq', 'inq')).toEqual({ ok: false, message: '不能连自己' });
    expect(connectNodes(v1, 'inq', 'outline')).toEqual({ ok: false, message: '已经连上' });
    expect(connectNodes(v1, 'pub', 'inq')).toEqual({ ok: false, message: '会成环' });
    expect(connectNodes(v1, 'missing', 'inq')).toEqual({ ok: false, message: '没有这个节点' });
    expect(connectNodes(v1, 'merge-prep', 'merge-pub')).toEqual({
      ok: false,
      message: '不能两个汇合点相连',
    });
    expect(connectNodes(v1, 'script', 'merge-prep')).toEqual({ ok: false, message: '已经连上' });
    expect(connectNodes(v1, 'settle', 'merge-prep')).toEqual({ ok: false, message: '会成环' });
    const into = connectNodes(v1, 'outline', 'merge-pub');
    expect(into.ok).toBe(true);
    if (into.ok) {
      expect(
        into.graph.edges.some((edge) => edge.source === 'outline' && edge.target === 'merge-pub'),
      ).toBe(true);
    }
    const outOf = connectNodes(v1, 'merge-prep', 'rev');
    expect(outOf.ok).toBe(true);
    if (outOf.ok) {
      expect(
        outOf.graph.edges.some((edge) => edge.source === 'merge-prep' && edge.target === 'rev'),
      ).toBe(true);
    }
    const added = connectNodes(v1, 'settle', 'dist');
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(
        added.graph.edges.some((edge) => edge.source === 'settle' && edge.target === 'dist'),
      ).toBe(true);
    }
  });

  test('adds and deletes stage nodes without touching anchors', () => {
    expect(addStageNode(v1, '  ')).toEqual({ ok: false, message: '需要名称' });
    expect(addStageNode(v1, '询单')).toEqual({ ok: false, message: '「询单」已存在' });
    const added = addStageNode(v1, '定妆');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const created = added.graph.nodes.find((node) => node.name === '定妆');
    expect(created?.kind).toBe('stage');
    const inquiry = v1.nodes.find((node) => node.id === 'inq')!;
    const stacked = addStageNode(v1, '定妆', { x: inquiry.x + 84, y: inquiry.y + 20 });
    if (stacked.ok) {
      const placed = stacked.graph.nodes.find((node) => node.name === '定妆')!;
      expect(Math.abs(placed.x - inquiry.x) > 20 || Math.abs(placed.y - inquiry.y) > 20).toBe(true);
    }
    const removed = removeElements(added.graph, [created!.id, 'merge-prep'], ['e-inq-outline']);
    expect(removed.nodes.some((node) => node.name === '定妆')).toBe(false);
    expect(removed.nodes.some((node) => node.id === 'merge-prep')).toBe(true);
    expect(removed.edges.some((edge) => edge.id === 'e-inq-outline')).toBe(false);
  });

  test('undo and redo restore structure and dragged positions', () => {
    const added = addStageNode(v1, '定妆');
    if (!added.ok) throw new Error('expected add');
    const start: HistoryState = { past: [], present: v1, future: [] };
    const committed = commitHistory(start, added.graph);
    const undone = undoHistory(committed);
    expect(undone.present.nodes.some((node) => node.name === '定妆')).toBe(false);
    const redone = redoHistory(undone);
    expect(redone.present.nodes.some((node) => node.name === '定妆')).toBe(true);

    const moved = applyPositions(
      v1,
      new Map(
        v1.nodes.map((node) => [
          node.id,
          { x: node.id === 'inq' ? node.x + 40 : node.x, y: node.y },
        ]),
      ),
    );
    const dragged = commitDrag(start, v1, moved);
    expect(dragged.past).toHaveLength(1);
    expect(dragged.present.nodes.find((node) => node.id === 'inq')!.x).toBe(
      v1.nodes.find((node) => node.id === 'inq')!.x + 40,
    );
    expect(commitDrag(start, v1, v1).past).toHaveLength(0);
    const anchor = v1.nodes.find((node) => node.id === 'merge-prep')!;
    const shifted = applyPositions(
      v1,
      new Map([['merge-prep', { x: anchor.x + 30, y: anchor.y + 20 }]]),
    );
    expect(shifted.nodes.find((node) => node.id === 'merge-prep')).toMatchObject({
      x: anchor.x + 30,
      y: anchor.y + 20,
    });
    const anchorDrag = commitDrag(start, v1, shifted);
    expect(
      undoHistory(anchorDrag).present.nodes.find((node) => node.id === 'merge-prep'),
    ).toMatchObject({
      x: anchor.x,
      y: anchor.y,
    });
  });
});
