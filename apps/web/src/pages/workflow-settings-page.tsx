import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTemplateDraftFromDefault,
  fetchTemplateVersions,
  publishTemplateDraft,
} from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { formatFullLocalTime } from '@/lib/format-time';

export function WorkflowSettingsPage() {
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: ['commercial', 'template-versions'],
    queryFn: fetchTemplateVersions,
  });

  const draftMut = useMutation({
    mutationFn: createTemplateDraftFromDefault,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['commercial', 'template-versions'] }),
  });

  const publishMut = useMutation({
    mutationFn: (versionId: string) => publishTemplateDraft(versionId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['commercial', 'template-versions'] }),
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
  const drafts = items.filter((v) => v.isDraft);

  return (
    <div className="space-y-6">
      <PageHeader
        title="工作流模板"
        description="修改默认模板并发布新版本。仅影响此后新建的项目；已有项目保持创建时的模板版本。"
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
                  <Button
                    type="button"
                    size="sm"
                    disabled={publishMut.isPending}
                    onClick={() => publishMut.mutate(v.id)}
                  >
                    {publishMut.isPending ? '发布中…' : '发布并设为默认'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            草稿编辑（节点/边/布局）可通过模板 API 与项目工作流编辑器同一套交互扩展；发布后新项目将使用新默认版本。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
