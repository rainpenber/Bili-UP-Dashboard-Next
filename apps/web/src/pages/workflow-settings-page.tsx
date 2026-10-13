import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  connectTemplateNodes,
  createTemplateDraftFromDefault,
  deleteTemplateEdge,
  deleteTemplateNode,
  fetchTemplateGraph,
  fetchTemplateVersions,
  publishTemplateDraft,
  applyTemplateBatchLayout,
  redoTemplateWorkflow,
  saveTemplateNode,
  undoTemplateWorkflow,
  validateTemplateDraft,
} from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { TemplateFlowEditor, type TemplateGraph } from '@/features/commercial/template-flow-editor';
import { formatFullLocalTime } from '@/lib/format-time';

export function WorkflowSettingsPage() {
  const qc = useQueryClient();
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  const versions = useQuery({
    queryKey: ['commercial', 'template-versions'],
    queryFn: fetchTemplateVersions,
  });

  const drafts = useMemo(() => (versions.data ?? []).filter((v) => v.isDraft), [versions.data]);

  const draftId = activeDraftId ?? drafts[0]?.id ?? null;

  const graphQuery = useQuery({
    queryKey: ['commercial', 'template-graph', draftId],
    queryFn: () => fetchTemplateGraph(draftId!),
    enabled: Boolean(draftId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['commercial', 'template-versions'] });
    void qc.invalidateQueries({ queryKey: ['commercial', 'template-graph'] });
  };

  const draftMut = useMutation({
    mutationFn: createTemplateDraftFromDefault,
    onSuccess: (res) => {
      setActiveDraftId((res as { draftId: string }).draftId);
      invalidate();
    },
  });

  const publishMut = useMutation({
    mutationFn: async (versionId: string) => {
      await validateTemplateDraft(versionId);
      return publishTemplateDraft(versionId);
    },
    onSuccess: () => {
      setActiveDraftId(null);
      invalidate();
    },
  });

  const graphMut = useMutation({
    mutationFn: async (fn: () => Promise<TemplateGraph>) => fn(),
    onSuccess: () => void graphQuery.refetch(),
  });

  if (versions.isLoading) return <LoadingListSkeleton rows={4} />;
  if (versions.isError) {
    return (
      <ErrorState
        message={versions.error instanceof Error ? versions.error.message : '加载失败'}
        onRetry={() => void versions.refetch()}
      />
    );
  }

  const items = versions.data ?? [];
  const defaultVersion = items.find((v) => v.isDefault);
  const graph = graphQuery.data;
  const pending = graphMut.isPending || draftMut.isPending || publishMut.isPending;
  const editorError =
    (graphMut.error ?? publishMut.error)
      ? ((graphMut.error ?? publishMut.error) as Error).message
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="工作流模板"
        description="编辑草稿模板图并发布。仅影响此后新建的项目；已有项目保持创建时的模板版本。"
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">版本列表</CardTitle>
          <Button
            type="button"
            variant="outline"
            disabled={draftMut.isPending || drafts.length > 0}
            onClick={() => draftMut.mutate()}
          >
            {draftMut.isPending ? '复制中…' : '从当前默认复制草稿'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {draftMut.isError ? (
            <p className="text-destructive">
              {draftMut.error instanceof Error ? draftMut.error.message : '创建草稿失败'}
            </p>
          ) : null}
          {publishMut.isError ? (
            <p className="text-destructive">
              {publishMut.error instanceof Error ? publishMut.error.message : '发布失败'}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            当前默认：v{defaultVersion?.version ?? '—'} · {defaultVersion?.name ?? '—'}
          </p>
          <ul className="divide-y rounded border">
            {items.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">
                    v{v.version} {v.name}
                    {v.isDefault ? ' · 默认' : ''}
                    {v.isDraft ? ' · 草稿' : ''}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    发布于 {formatFullLocalTime(v.publishedAt)}
                  </p>
                </div>
                {v.isDraft ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={draftId === v.id ? 'default' : 'outline'}
                      onClick={() => setActiveDraftId(v.id)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={publishMut.isPending}
                      onClick={() => publishMut.mutate(v.id)}
                    >
                      {publishMut.isPending ? '发布中…' : '发布并设为默认'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {draftId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">草稿图编辑</CardTitle>
          </CardHeader>
          <CardContent>
            {graphQuery.isLoading ? (
              <LoadingListSkeleton rows={3} />
            ) : graphQuery.isError ? (
              <ErrorState
                message={
                  graphQuery.error instanceof Error ? graphQuery.error.message : '加载草稿失败'
                }
                onRetry={() => void graphQuery.refetch()}
              />
            ) : graph ? (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => graphMut.mutate(() => undoTemplateWorkflow(draftId!))}
                  >
                    撤销
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => graphMut.mutate(() => redoTemplateWorkflow(draftId!))}
                  >
                    重做
                  </Button>
                </div>
                <TemplateFlowEditor
                  graph={graph}
                  pending={pending}
                  error={editorError}
                  onCreateNode={async (node) => {
                    await graphMut.mutateAsync(() =>
                      saveTemplateNode(draftId, {
                        name: node.name,
                        slug: node.slug,
                        phase: node.phase,
                        posX: node.pos_x,
                        posY: node.pos_y,
                        isOptional: node.is_optional,
                        packageId: node.package_id,
                      }),
                    );
                  }}
                  onMoveNode={async (nodeId, posX, posY) => {
                    const n = graph.nodes.find((x) => x.id === nodeId);
                    if (!n) return;
                    await graphMut.mutateAsync(() =>
                      saveTemplateNode(
                        draftId,
                        {
                          id: n.id,
                          name: n.name,
                          slug: n.slug,
                          phase: n.phase,
                          posX,
                          posY,
                          isOptional: n.is_optional,
                          packageId: n.package_id,
                        },
                        { recordUndo: false },
                      ),
                    );
                  }}
                  onConnect={async (from, to) => {
                    await graphMut.mutateAsync(() => connectTemplateNodes(draftId, from, to));
                  }}
                  onDeleteEdge={async (edgeId) => {
                    await graphMut.mutateAsync(() => deleteTemplateEdge(draftId, edgeId));
                  }}
                  onSaveNode={async (node) => {
                    await graphMut.mutateAsync(() =>
                      saveTemplateNode(draftId, {
                        id: node.id,
                        name: node.name,
                        slug: node.slug,
                        phase: node.phase,
                        posX: node.pos_x,
                        posY: node.pos_y,
                        isOptional: node.is_optional,
                        packageId: node.package_id,
                      }),
                    );
                  }}
                  onDeleteNode={async (nodeId) => {
                    await graphMut.mutateAsync(() => deleteTemplateNode(draftId, nodeId));
                  }}
                  onAutoLayout={async (positions) => {
                    await graphMut.mutateAsync(() =>
                      applyTemplateBatchLayout(
                        draftId,
                        [...positions.entries()].map(([nodeId, pos]) => ({
                          nodeId,
                          posX: pos.posX,
                          posY: pos.posY,
                        })),
                      ),
                    );
                  }}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : drafts.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无草稿，请先从默认模板复制一份草稿。</p>
      ) : null}
    </div>
  );
}
