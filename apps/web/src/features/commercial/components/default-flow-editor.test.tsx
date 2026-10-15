import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { DefaultTemplateWorkspace, TemplateVersionGraph } from '@studio/contracts';
import type { DefaultFlowClient } from '../default-flow-api';
import { DefaultFlowEditor } from './default-flow-editor';

setDefaultTimeout(30_000);

const V1 = 'ffff1111-1111-4111-8111-111111111111';
const INQUIRY = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const OUTLINE = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';
const PUBLISH = 'dddddddd-dddd-4ddd-8ddd-ddddddddd009';

function version(overrides: Partial<TemplateVersionGraph> = {}): TemplateVersionGraph {
  return {
    id: V1,
    slug: 'default_sponsorship',
    name: '默认商单流程',
    version: 1,
    isDraft: false,
    isDefault: true,
    publishedAt: '2026-10-15T00:00:00.000Z',
    nodes: [
      {
        id: INQUIRY,
        slug: 'inquiry',
        name: '询单',
        kind: 'stage',
        isOptional: false,
        posX: 0,
        posY: 0,
        packageId: null,
      },
      {
        id: OUTLINE,
        slug: 'outline',
        name: '大纲',
        kind: 'stage',
        isOptional: false,
        posX: 0,
        posY: 120,
        packageId: null,
      },
      {
        id: PUBLISH,
        slug: 'publish',
        name: '发布',
        kind: 'stage',
        isOptional: false,
        posX: 0,
        posY: 240,
        packageId: null,
      },
    ],
    edges: [
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', fromNodeId: INQUIRY, toNodeId: OUTLINE },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', fromNodeId: OUTLINE, toNodeId: PUBLISH },
    ],
    ...overrides,
  };
}

function cloneVersion(
  source: TemplateVersionGraph,
  id: string,
  versionNumber: number,
): TemplateVersionGraph {
  const nodeIds = new Map(source.nodes.map((node) => [node.id, crypto.randomUUID()]));
  return {
    ...source,
    id,
    version: versionNumber,
    isDraft: true,
    isDefault: false,
    publishedAt: null,
    nodes: source.nodes.map((node) => ({ ...node, id: nodeIds.get(node.id)! })),
    edges: source.edges.map((edge) => ({
      id: crypto.randomUUID(),
      fromNodeId: nodeIds.get(edge.fromNodeId)!,
      toNodeId: nodeIds.get(edge.toNodeId)!,
    })),
  };
}

function wouldCycle(
  edges: TemplateVersionGraph['edges'],
  fromNodeId: string,
  toNodeId: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const next = outgoing.get(edge.fromNodeId) ?? [];
    next.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, next);
  }
  const stack = [toNodeId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromNodeId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function memoryClient(): DefaultFlowClient {
  let workspace: DefaultTemplateWorkspace = {
    slug: 'default_sponsorship',
    draft: null,
    published: [version()],
  };
  const snapshot = (): DefaultTemplateWorkspace => structuredClone(workspace);
  const requireDraft = () => {
    const draft = workspace.draft;
    if (!draft) throw new Error('没有可发布的草稿');
    return draft;
  };
  return {
    loadWorkspace: async () => snapshot(),
    startDraft: async () => {
      if (!workspace.draft) {
        const source = workspace.published.find((item) => item.isDefault) ?? workspace.published[0];
        if (!source) throw new Error('没有已发布的默认流程');
        const next = workspace.published.reduce((max, item) => Math.max(max, item.version), 0) + 1;
        workspace.draft = cloneVersion(source, crypto.randomUUID(), next);
      }
      return snapshot();
    },
    discardDraft: async () => {
      if (!workspace.draft) throw new Error('没有可丢弃的草稿');
      workspace.draft = null;
      return snapshot();
    },
    publishDraft: async () => {
      const draft = requireDraft();
      const published = {
        ...draft,
        isDraft: false,
        isDefault: true,
        publishedAt: '2026-10-15T08:00:00.000Z',
      };
      workspace = {
        slug: workspace.slug,
        draft: null,
        published: [
          published,
          ...workspace.published.map((item) => ({ ...item, isDefault: false })),
        ],
      };
      return snapshot();
    },
    addNode: async (versionId, body) => {
      const draft = requireDraft();
      if (draft.id !== versionId) throw new Error('已发布的模板版本不可修改');
      const name = body.name.trim();
      if (!name) throw new Error('节点名称不能为空。');
      if (draft.nodes.some((node) => node.name.trim() === name)) {
        throw new Error(`节点名称「${name}」已存在，同一流程内名称必须唯一。`);
      }
      draft.nodes.push({
        id: crypto.randomUUID(),
        slug: 'n_test',
        name,
        kind: body.kind,
        isOptional: body.isOptional,
        posX: body.posX,
        posY: body.posY,
        packageId: null,
      });
      return snapshot();
    },
    renameNode: async (versionId, nodeId, name) => {
      const draft = requireDraft();
      if (draft.id !== versionId) throw new Error('已发布的模板版本不可修改');
      const trimmed = name.trim();
      if (!trimmed) throw new Error('节点名称不能为空。');
      if (draft.nodes.some((node) => node.id !== nodeId && node.name.trim() === trimmed)) {
        throw new Error(`节点名称「${trimmed}」已存在，同一流程内名称必须唯一。`);
      }
      const node = draft.nodes.find((item) => item.id === nodeId);
      if (!node) throw new Error('找不到该节点。');
      node.name = trimmed;
      return snapshot();
    },
    deleteNode: async (versionId, nodeId) => {
      const draft = requireDraft();
      if (draft.id !== versionId) throw new Error('已发布的模板版本不可修改');
      const before = draft.nodes.length;
      draft.nodes = draft.nodes.filter((node) => node.id !== nodeId);
      if (draft.nodes.length === before) throw new Error('找不到该节点。');
      draft.edges = draft.edges.filter(
        (edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId,
      );
      return snapshot();
    },
    addEdge: async (versionId, fromNodeId, toNodeId) => {
      const draft = requireDraft();
      if (draft.id !== versionId) throw new Error('已发布的模板版本不可修改');
      const from = draft.nodes.find((node) => node.id === fromNodeId);
      const to = draft.nodes.find((node) => node.id === toNodeId);
      if (!from || !to) throw new Error('找不到要连接的节点。');
      if (fromNodeId === toNodeId) throw new Error('不能将节点连接到自身。');
      if (
        draft.edges.some((edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)
      ) {
        throw new Error(`连接「${from.name} → ${to.name}」已存在。`);
      }
      if (wouldCycle(draft.edges, fromNodeId, toNodeId)) {
        throw new Error(`无法连接「${from.name} → ${to.name}」：会在流程中形成环路。`);
      }
      draft.edges.push({ id: crypto.randomUUID(), fromNodeId, toNodeId });
      return snapshot();
    },
    disconnectEdge: async (versionId, fromNodeId, toNodeId) => {
      const draft = requireDraft();
      if (draft.id !== versionId) throw new Error('已发布的模板版本不可修改');
      const from = draft.nodes.find((node) => node.id === fromNodeId);
      const to = draft.nodes.find((node) => node.id === toNodeId);
      if (!from || !to) throw new Error('找不到要断开的节点。');
      const before = draft.edges.length;
      draft.edges = draft.edges.filter(
        (edge) => !(edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId),
      );
      if (draft.edges.length === before) {
        throw new Error(`不存在连接「${from.name} → ${to.name}」，无法断开。`);
      }
      return snapshot();
    },
    createProject: async (name, templateVersionId) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('项目名称不能为空。');
      const found = workspace.published.find((item) => item.id === templateVersionId);
      if (!found) throw new Error('找不到这个模板版本');
      return {
        id: crypto.randomUUID(),
        name: trimmed,
        workflowId: crypto.randomUUID(),
        templateVersionId,
      };
    },
  };
}

afterEach(() => cleanup());

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
}

async function startDraft() {
  fireEvent.click(screen.getByTestId('default-flow-start-draft'));
  await screen.findByTestId('default-flow-draft-editor');
}

function optionValue(select: HTMLElement, label: string): string {
  const option = [...(select as HTMLSelectElement).options].find((item) => item.text === label);
  if (!option) throw new Error(`missing option ${label}`);
  return option.value;
}

describe('DefaultFlowEditor', () => {
  test('publishing a version keeps the previous version viewable', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor client={memoryClient()} />
      </div>,
    );
    await waitForGraphReady(container);
    expect(screen.getByTestId('default-flow-scope-notice').textContent).toContain('不会静默改写');
    expect(screen.getByTestId('default-flow-version-1')).toBeTruthy();

    await startDraft();
    fireEvent.change(screen.getByTestId('workflow-add-node-name'), {
      target: { value: '发布后回访' },
    });
    fireEvent.click(screen.getByTestId('workflow-add-node'));
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('发布后回访'),
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByTestId('default-flow-publish'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-2')).toBeTruthy();
      expect(screen.getByTestId('default-flow-publish-notice').textContent).toContain('已有项目');
    });

    fireEvent.click(screen.getByTestId('default-flow-view-version-1'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-view')).toBeTruthy();
    });
    await waitForGraphReady(container);
    expect(
      [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
        el.textContent?.includes('发布后回访'),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByTestId('default-flow-view-version-2'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-view').textContent).toContain('v2');
    });
    await waitForGraphReady(container);
    expect(
      [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
        el.textContent?.includes('发布后回访'),
      ),
    ).toBe(true);
  });

  test('shows the server cycle and duplicate-name messages and does not apply them', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor client={memoryClient()} />
      </div>,
    );
    await waitForGraphReady(container);
    await startDraft();
    await waitForGraphReady(container);
    const before = container.querySelectorAll('.react-flow__edge-path').length;

    fireEvent.change(screen.getByTestId('workflow-add-node-name'), { target: { value: '大纲' } });
    fireEvent.click(screen.getByTestId('workflow-add-node'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-action-error').textContent).toBe(
        '节点名称「大纲」已存在，同一流程内名称必须唯一。',
      );
    });

    const from = screen.getByTestId('workflow-connect-from');
    const to = screen.getByTestId('workflow-connect-to');
    fireEvent.change(from, { target: { value: optionValue(from, '发布') } });
    fireEvent.change(to, { target: { value: optionValue(to, '询单') } });
    fireEvent.click(screen.getByTestId('workflow-connect'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-action-error').textContent).toBe(
        '无法连接「发布 → 询单」：会在流程中形成环路。',
      );
    });
    expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(before);
  });

  test('delete confirmation names the connections and waits for confirm', async () => {
    const client = memoryClient();
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor client={client} />
      </div>,
    );
    await waitForGraphReady(container);
    await startDraft();
    await waitForGraphReady(container);

    const outline = [...container.querySelectorAll('[data-workflow-node]')].find((el) =>
      el.textContent?.includes('大纲'),
    );
    if (!outline) throw new Error('missing 大纲');
    fireEvent.click(outline);
    fireEvent.click(screen.getByTestId('workflow-delete-node'));

    const dialog = await screen.findByTestId('workflow-delete-confirm');
    expect(dialog.textContent).toContain('删除节点「大纲」将同时移除以下连接：');
    expect(dialog.textContent).toContain('询单 → 大纲');
    expect(dialog.textContent).toContain('大纲 → 发布');
    expect(outline.isConnected).toBe(true);

    fireEvent.click(screen.getByTestId('workflow-delete-confirm-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('workflow-delete-confirm')).toBeNull();
    });
    expect(container.querySelector('[data-workflow-node]')?.isConnected).toBe(true);
    expect(
      [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
        el.textContent?.includes('大纲'),
      ),
    ).toBe(true);

    fireEvent.click(screen.getByTestId('workflow-delete-node'));
    await screen.findByTestId('workflow-delete-confirm');
    fireEvent.click(screen.getByTestId('workflow-delete-confirm-yes'));
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('大纲'),
        ),
      ).toBe(false);
    });
    const reloaded = await client.loadWorkspace();
    expect(reloaded.draft?.nodes.some((node) => node.name === '大纲')).toBe(false);
    expect(
      reloaded.draft?.edges.some((edge) =>
        reloaded.draft?.nodes.every(
          (node) => node.id !== edge.fromNodeId && node.id !== edge.toNodeId,
        ),
      ),
    ).toBe(false);
  });

  test('a refresh reloads the stored draft', async () => {
    const client = memoryClient();
    const first = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor client={client} />
      </div>,
    );
    await waitForGraphReady(first.container);
    await startDraft();
    fireEvent.change(screen.getByTestId('workflow-add-node-name'), {
      target: { value: '发布后回访' },
    });
    fireEvent.click(screen.getByTestId('workflow-add-node'));
    await waitFor(() => {
      expect(
        [...first.container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('发布后回访'),
        ),
      ).toBe(true);
    });
    first.unmount();

    const second = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor client={client} />
      </div>,
    );
    await screen.findByTestId('default-flow-draft-editor');
    await waitFor(() => {
      expect(
        [...second.container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('发布后回访'),
        ),
      ).toBe(true);
    });
    expect(screen.getByTestId('default-flow-version-1')).toBeTruthy();
  });
});
