import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  getDefaultFlowWorkspace,
  publishDefaultFlowVersion,
  saveDefaultFlowDraft,
  setDefaultFlowDraft,
  subscribeDefaultFlowWorkspace,
  viewDefaultFlowVersion,
} from '../default-flow-store';
import { cloneWorkflowGraph } from '../workflow-edit-logic';
import { useWorkflowEditor } from '../use-workflow-editor';
import { WorkflowGraphEditor } from './workflow-graph-editor';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

function useDefaultFlowWorkspace() {
  return useSyncExternalStore(subscribeDefaultFlowWorkspace, getDefaultFlowWorkspace);
}

export function DefaultFlowEditor() {
  const workspace = useDefaultFlowWorkspace();
  const viewingPublished = workspace.viewingVersionId != null;
  const activeVersion = workspace.publishedVersions.find(
    (v) => v.id === workspace.viewingVersionId,
  );

  // Stable seed for the draft editor; refresh only when leaving a published view.
  const [draftSeed, setDraftSeed] = useState(() => cloneWorkflowGraph(workspace.draft));
  const wasViewing = useRef(viewingPublished);

  useEffect(() => {
    if (wasViewing.current && !viewingPublished) {
      setDraftSeed(cloneWorkflowGraph(getDefaultFlowWorkspace().draft));
    }
    wasViewing.current = viewingPublished;
  }, [viewingPublished]);

  const editor = useWorkflowEditor(draftSeed);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-testid="default-flow-editor">
      <p
        className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        data-testid="default-flow-demo-notice"
      >
        演示数据：此处编辑的是新项目默认流程模板。发布版本只影响之后新建的项目，不会静默改写已有项目实例。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={viewingPublished ? 'outline' : 'default'}
          disabled={!viewingPublished}
          onClick={() => {
            viewDefaultFlowVersion(null);
            setPublishNotice(null);
          }}
          data-testid="default-flow-edit-draft"
        >
          编辑草稿
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={viewingPublished}
          onClick={() => {
            setDefaultFlowDraft(editor.graph);
            saveDefaultFlowDraft();
            setPublishNotice('草稿已保存（仅本页内存）。');
          }}
          data-testid="default-flow-save-draft"
        >
          保存草稿
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={viewingPublished}
          onClick={() => {
            setDefaultFlowDraft(editor.graph);
            const published = publishDefaultFlowVersion();
            setPublishNotice(
              `已发布 v${published.version}。已有项目实例不受影响；仅新项目会使用最新发布版。`,
            );
          }}
          data-testid="default-flow-publish"
        >
          发布版本
        </Button>
      </div>

      {publishNotice ? (
        <p className="text-sm text-foreground" data-testid="default-flow-publish-notice">
          {publishNotice}
        </p>
      ) : null}

      <div className="space-y-2" data-testid="default-flow-version-list">
        <p className="text-sm font-medium text-foreground">已发布版本</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {workspace.publishedVersions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <span data-testid={`default-flow-version-${v.version}`}>
                v{v.version} · {v.publishedAtLabel}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  // Persist in-progress draft before switching to a published snapshot.
                  if (!viewingPublished) setDefaultFlowDraft(editor.graph);
                  viewDefaultFlowVersion(v.id);
                  setPublishNotice(null);
                }}
                data-testid={`default-flow-view-version-${v.version}`}
              >
                查看
              </Button>
            </li>
          ))}
        </ul>
      </div>

      {viewingPublished && activeVersion ? (
        <div className="space-y-2" data-testid="default-flow-version-view">
          <p className="text-sm text-muted-foreground">
            正在查看已发布 v{activeVersion.version}（只读）。返回「编辑草稿」可继续改模板。
          </p>
          <WorkflowGraphReadonly graph={cloneWorkflowGraph(activeVersion.graph)} />
        </div>
      ) : (
        <WorkflowGraphEditor
          editor={editor}
          structureOnly
          mockNotice="演示数据：默认流程草稿仅保存在本页内存；发布不会改写已有项目。"
        />
      )}
    </div>
  );
}
