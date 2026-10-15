import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkflowGraphReadonly } from '@/features/commercial/components/workflow-graph-readonly';
import { useDefaultWorkflowQuery } from '@/features/commercial/use-commercial-queries';

export function IntegrationsSettingsPage() {
  const query = useDefaultWorkflowQuery();

  return (
    <>
      <PageHeader
        title="集成与设置"
        description="通知渠道与对接能力后续再接；这里先看新商单默认走什么流程。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '集成与设置' }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,22rem)_1fr] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">通知与集成（规划中）</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            微信、飞书、OneNote 等接入在本里程碑不做真实配置；上线后在这里统一管理。
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">新项目默认流程</CardTitle>
            {query.data ? (
              <p className="text-sm font-normal text-muted-foreground">{query.data.description}</p>
            ) : null}
          </CardHeader>
          <CardContent>
            {query.isLoading ? <LoadingListSkeleton rows={3} /> : null}
            {query.isError ? (
              <ErrorState
                message={query.error instanceof Error ? query.error.message : '加载失败'}
                onRetry={() => query.refetch()}
              />
            ) : null}
            {query.data ? <WorkflowGraphReadonly graph={query.data.graph} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
