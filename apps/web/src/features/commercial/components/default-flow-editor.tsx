import { useEffect, useState } from 'react';
import type { TemplateVersionGraph, WfNodeKind } from '@studio/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { defaultFlowClient, type DefaultFlowClient } from '../default-flow-api';
import { nextTemplateNodePosition, templateVersionToWorkflowGraph } from '../template-graph';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

type DeletePreview = {
  nodeId: string;
  nodeName: string;
  connections: Array<{ fromName: string; toName: string }>;
};

function publishedLabel(iso: string | null): string {
  if (!iso) return '未发布';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function connectionsTouching(version: TemplateVersionGraph, nodeId: string) {
  const names = new Map(version.nodes.map((node) => [node.id, node.name]));
  return version.edges
    .filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)
    .map((edge) => ({
      fromName: names.get(edge.fromNodeId) ?? edge.fromNodeId,
      toName: names.get(edge.toNodeId) ?? edge.toNodeId,
    }));
}

export function DefaultFlowEditor({
  client = defaultFlowClient,
  onProjectCreated,
}: {
  client?: DefaultFlowClient;
  onProjectCreated?: (project: { id: string; name: string }) => void;
}) {
  const [workspace, setWorkspace] = useState<Awaited<
    ReturnType<DefaultFlowClient['loadWorkspace']>
  > | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [kind, setKind] = useState<WfNodeKind>('stage');
  const [optional, setOptional] = useState(false);
  const [connectFrom, setConnectFrom] = useState('');
  const [connectTo, setConnectTo] = useState('');
  const [rename, setRename] = useState('');
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectVersionId, setProjectVersionId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void client.loadWorkspace().then(
      (value) => {
        if (!cancelled) setWorkspace(value);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '加载失败');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const viewing = workspace?.published.find((version) => version.id === viewingId) ?? null;
  const draft = workspace?.draft ?? null;
  const editing = viewing == null && draft != null;
  const active =
    viewing ??
    draft ??
    workspace?.published.find((version) => version.isDefault) ??
    workspace?.published[0] ??
    null;
  const selected = active?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    setRename(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  async function apply(
    action: () => Promise<NonNullable<typeof workspace>>,
  ): Promise<NonNullable<typeof workspace> | null> {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      setWorkspace(next);
      setDeletePreview(null);
      return next;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '请求失败');
      setNotice(null);
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => window.location.reload()} />;
  }
  if (!workspace || !active) {
    return <LoadingListSkeleton rows={4} />;
  }

  const graph = templateVersionToWorkflowGraph(active);
  const chosenProjectVersion =
    workspace.published.find((version) => version.id === projectVersionId) ??
    workspace.published.find((version) => version.isDefault) ??
    workspace.published[0];

  return (
    <div className="space-y-4" data-testid="default-flow-editor">
      <p
        className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        data-testid="default-flow-scope-notice"
      >
        发布版本只影响之后新建的项目，不会静默改写已有项目实例。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || draft != null}
          onClick={() => {
            void apply(() => client.startDraft()).then((next) => {
              if (next) {
                setViewingId(null);
                setNotice(null);
              }
            });
          }}
          data-testid="default-flow-start-draft"
        >
          从当前发布版开始草稿
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editing ? 'default' : 'outline'}
          disabled={busy || !viewing}
          onClick={() => {
            setViewingId(null);
            setNotice(null);
            setActionError(null);
            if (!draft) {
              void apply(() => client.startDraft()).then((next) => {
                if (next) setNotice(null);
              });
            }
          }}
          data-testid="default-flow-edit-draft"
        >
          编辑草稿
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !editing}
          onClick={() => {
            void apply(() => client.loadWorkspace()).then((next) => {
              if (next) setNotice('草稿已保存在服务器。');
            });
          }}
          data-testid="default-flow-save-draft"
        >
          保存草稿
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || !editing}
          onClick={() => {
            void apply(() => client.publishDraft()).then((next) => {
              if (!next) return;
              const published = next.published.find((version) => version.isDefault);
              setViewingId(null);
              setNotice(
                `已发布 v${published?.version ?? ''}。已有项目实例不受影响；仅新项目会使用最新发布版。`,
              );
            });
          }}
          data-testid="default-flow-publish"
        >
          发布版本
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !draft}
          onClick={() => {
            void apply(() => client.discardDraft()).then((next) => {
              if (next) {
                setSelectedNodeId(null);
                setNotice('草稿已丢弃。');
              }
            });
          }}
          data-testid="default-flow-discard"
        >
          丢弃草稿
        </Button>
      </div>

      {notice ? (
        <p className="text-sm text-foreground" data-testid="default-flow-publish-notice">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="default-flow-action-error"
        >
          {actionError}
        </p>
      ) : null}

      <div className="space-y-2" data-testid="default-flow-version-list">
        <p className="text-sm font-medium text-foreground">已发布版本</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {workspace.published.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-2">
              <span data-testid={`default-flow-version-${version.version}`}>
                v{version.version} · {publishedLabel(version.publishedAt)}
                {version.isDefault ? ' · 当前默认' : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setViewingId(version.id);
                  setNotice(null);
                  setActionError(null);
                  setDeletePreview(null);
                  setSelectedNodeId(null);
                }}
                data-testid={`default-flow-view-version-${version.version}`}
              >
                查看
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="space-y-3 rounded-lg border bg-card/40 p-3"
        data-testid="default-flow-create-project"
        onSubmit={(event) => {
          event.preventDefault();
          if (!chosenProjectVersion) return;
          setBusy(true);
          setActionError(null);
          void client
            .createProject(projectName, chosenProjectVersion.id)
            .then((created) => {
              setNotice(`已创建项目「${created.name}」。`);
              onProjectCreated?.(created);
            })
            .catch((err: unknown) => {
              setActionError(err instanceof Error ? err.message : '创建项目失败');
              setNotice(null);
            })
            .finally(() => setBusy(false));
        }}
      >
        <p className="text-sm font-medium text-foreground">从已发布版本创建项目</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>项目名称</span>
            <Input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="h-8 w-44 text-sm"
              data-testid="default-flow-project-name"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>模板版本</span>
            <select
              className="flex h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
              value={chosenProjectVersion?.id ?? ''}
              onChange={(event) => setProjectVersionId(event.target.value)}
              data-testid="default-flow-project-version"
            >
              {workspace.published.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version}
                  {version.isDefault ? '（当前默认）' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !chosenProjectVersion}
            data-testid="default-flow-create-project-submit"
          >
            创建项目
          </Button>
        </div>
      </form>

      {viewing ? (
        <div className="space-y-2" data-testid="default-flow-version-view">
          <p className="text-sm text-muted-foreground">
            正在查看已发布 v{viewing.version}（只读）。返回「编辑草稿」可继续改模板。
          </p>
          <WorkflowGraphReadonly graph={graph} />
        </div>
      ) : editing && draft ? (
        <div className="space-y-4" data-testid="default-flow-draft-editor">
          <div
            className="space-y-3 rounded-lg border bg-card/40 p-3"
            data-testid="workflow-structure-panel"
          >
            <p className="text-sm font-medium text-foreground">结构编辑</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>新节点名称</span>
                <Input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="例如：样片预审"
                  className="h-8 w-44 text-sm"
                  data-testid="workflow-add-node-name"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>种类</span>
                <select
                  className="flex h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
                  value={kind}
                  onChange={(event) => setKind(event.target.value === 'merge' ? 'merge' : 'stage')}
                  data-testid="default-flow-add-kind"
                >
                  <option value="stage">阶段</option>
                  <option value="merge">汇合</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={optional}
                  onChange={(event) => setOptional(event.target.checked)}
                  data-testid="default-flow-add-optional"
                />
                可选
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const position = nextTemplateNodePosition(draft.nodes);
                  void apply(() =>
                    client.addNode(draft.id, {
                      name: newName,
                      kind,
                      isOptional: optional,
                      posX: position.posX,
                      posY: position.posY,
                    }),
                  ).then((next) => {
                    if (next) {
                      setNewName('');
                      setNotice(null);
                    }
                  });
                }}
                data-testid="workflow-add-node"
              >
                添加节点
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>从</span>
                <select
                  className="flex h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                  value={connectFrom}
                  onChange={(event) => setConnectFrom(event.target.value)}
                  data-testid="workflow-connect-from"
                >
                  <option value="">选择节点</option>
                  {draft.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>到</span>
                <select
                  className="flex h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                  value={connectTo}
                  onChange={(event) => setConnectTo(event.target.value)}
                  data-testid="workflow-connect-to"
                >
                  <option value="">选择节点</option>
                  {draft.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || !connectFrom || !connectTo}
                onClick={() => {
                  void apply(() => client.addEdge(draft.id, connectFrom, connectTo)).then(
                    (next) => {
                      if (next) setNotice(null);
                    },
                  );
                }}
                data-testid="workflow-connect"
              >
                连接
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !connectFrom || !connectTo}
                onClick={() => {
                  void apply(() => client.disconnectEdge(draft.id, connectFrom, connectTo)).then(
                    (next) => {
                      if (next) setNotice(null);
                    },
                  );
                }}
                data-testid="workflow-disconnect"
              >
                断开连接
              </Button>
            </div>
            {selected ? (
              <div className="flex flex-wrap items-end gap-2">
                <span className="text-xs text-muted-foreground">已选节点：{selected.name}</span>
                <Input
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  className="h-8 w-44 text-sm"
                  data-testid="default-flow-rename-name"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void apply(() => client.renameNode(draft.id, selected.id, rename)).then(
                      (next) => {
                        if (next) setNotice(null);
                      },
                    );
                  }}
                  data-testid="default-flow-rename"
                >
                  重命名
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    const connections = connectionsTouching(draft, selected.id);
                    if (connections.length === 0) {
                      void apply(() => client.deleteNode(draft.id, selected.id)).then((next) => {
                        if (next) {
                          setSelectedNodeId(null);
                          setNotice(null);
                        }
                      });
                      return;
                    }
                    setDeletePreview({ nodeId: selected.id, nodeName: selected.name, connections });
                    setActionError(null);
                  }}
                  data-testid="workflow-delete-node"
                >
                  删除节点
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">点击节点后可重命名或删除该节点。</p>
            )}
            <ul
              className="max-h-28 overflow-auto text-xs text-muted-foreground"
              data-testid="workflow-connection-list"
              aria-label="当前连接"
            >
              {draft.edges.map((edge) => {
                const fromName =
                  draft.nodes.find((node) => node.id === edge.fromNodeId)?.name ?? edge.fromNodeId;
                const toName =
                  draft.nodes.find((node) => node.id === edge.toNodeId)?.name ?? edge.toNodeId;
                return (
                  <li key={edge.id} data-connection={`${edge.fromNodeId}->${edge.toNodeId}`}>
                    {fromName} → {toName}
                  </li>
                );
              })}
            </ul>
          </div>
          {deletePreview ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              role="alertdialog"
              data-testid="workflow-delete-confirm"
            >
              <p>
                删除节点「{deletePreview.nodeName}」将同时移除以下连接：
                {deletePreview.connections
                  .map((item) => `${item.fromName} → ${item.toName}`)
                  .join('；')}
                。确认继续？
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    const nodeId = deletePreview.nodeId;
                    void apply(() => client.deleteNode(draft.id, nodeId)).then((next) => {
                      if (next) {
                        setSelectedNodeId(null);
                        setNotice(null);
                      }
                    });
                  }}
                  data-testid="workflow-delete-confirm-yes"
                >
                  确认删除
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDeletePreview(null)}
                  data-testid="workflow-delete-confirm-cancel"
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          <WorkflowGraphCanvasProvider
            graph={graph}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </div>
      ) : (
        <WorkflowGraphReadonly graph={graph} />
      )}
    </div>
  );
}
