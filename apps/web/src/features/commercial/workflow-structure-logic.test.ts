import { describe, expect, test } from 'bun:test';
import { createProjectWorkflow } from './workflow-graph-canonical';
import {
  addWorkflowNode,
  attemptDeleteWorkflowNode,
  confirmDeleteWorkflowNode,
  connectWorkflowNodes,
  disconnectWorkflowNodes,
  listWorkflowConnections,
} from './workflow-structure-logic';

describe('workflow structure logic', () => {
  test('refuses duplicate node names with a readable reason', () => {
    const graph = createProjectWorkflow();
    const result = addWorkflowNode(graph, '大纲');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('大纲');
      expect(result.message).toContain('唯一');
    }
  });

  test('refuses a connection that would create a cycle', () => {
    const graph = createProjectWorkflow();
    const result = connectWorkflowNodes(graph, 'script', 'inq');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('环路');
    }
    expect(listWorkflowConnections(graph)).toEqual(
      listWorkflowConnections(createProjectWorkflow()),
    );
  });

  test('delete of a connected node requires confirmation listing connections', () => {
    const graph = createProjectWorkflow();
    const attempt = attemptDeleteWorkflowNode(graph, 'outline');
    expect(attempt.status).toBe('needs_confirmation');
    if (attempt.status === 'needs_confirmation') {
      expect(attempt.preview.connections.length).toBeGreaterThan(0);
      expect(
        attempt.preview.connections.some(
          (c) => c.fromName.includes('询单') || c.toName.includes('询单'),
        ),
      ).toBe(true);
    }
    const confirmed = confirmDeleteWorkflowNode(graph, 'outline');
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(
        listWorkflowConnections(confirmed.graph).some(
          (c) => c.from === 'outline' || c.to === 'outline',
        ),
      ).toBe(false);
    }
  });

  test('adding a node does not create any connections', () => {
    const base = createProjectWorkflow();
    const before = listWorkflowConnections(base);
    const added = addWorkflowNode(base, '样片预审');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(listWorkflowConnections(added.graph)).toEqual(before);
    expect(
      listWorkflowConnections(added.graph).some((c) => {
        const nodes = added.graph.steps.flatMap((s) => (s.kind === 'serial' ? [s.node] : s.nodes));
        const neu = nodes.find((n) => n.name === '样片预审');
        return neu != null && (c.from === neu.id || c.to === neu.id);
      }),
    ).toBe(false);
  });

  test('connect and disconnect mutate the connection set', () => {
    const base = createProjectWorkflow();
    const added = addWorkflowNode(base, '样片预审');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const newId = added.graph.steps
      .flatMap((s) => (s.kind === 'serial' ? [s.node] : s.nodes))
      .find((n) => n.name === '样片预审')!.id;

    const connected = connectWorkflowNodes(added.graph, 'rev', newId);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(
      listWorkflowConnections(connected.graph).some((c) => c.from === 'rev' && c.to === newId),
    ).toBe(true);

    const afterDisconnect = disconnectWorkflowNodes(connected.graph, 'rev', newId);
    expect(afterDisconnect.ok).toBe(true);
    if (!afterDisconnect.ok) return;
    expect(
      listWorkflowConnections(afterDisconnect.graph).some(
        (c) => c.from === 'rev' && c.to === newId,
      ),
    ).toBe(false);
  });
});
