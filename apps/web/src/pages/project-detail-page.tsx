import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PublishPanel,
  readPublishOverride,
  type PublishOverride,
} from '@/features/commercial/components/publish-panel';
import {
  useProjectWorkflowEditor,
  WorkflowGraphEditor,
} from '@/features/commercial/components/workflow-graph-editor';
import { WorkflowGraphReadonly } from '@/features/commercial/components/workflow-graph-readonly';
import { deriveWorkflowSummary } from '@/features/commercial/workflow-edit-logic';
import { formatYuan } from '@/features/commercial/commercial-selectors';
import { useCommercialProjectQuery } from '@/features/commercial/use-commercial-queries';
import { toUserErrorMessage } from '@/lib/user-facing-error';
import { cn } from '@/lib/utils';

function ScheduleLine({ name, dateLabel }: { name: string; dateLabel: string }) {
  return (
    <span>
      {name} {dateLabel}
    </span>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = useCommercialProjectQuery(projectId);
  const [publishOverride, setPublishOverride] = useState<PublishOverride | null>(() =>
    projectId ? readPublishOverride(projectId) : null,
  );
  const [finishedOpen, setFinishedOpen] = useState(false);

  const projectForEditor = query.data;
  const workflowEditor = useProjectWorkflowEditor(projectForEditor?.workflow ?? { steps: [] });
  const workflowSummary = useMemo(
    () => deriveWorkflowSummary(workflowEditor.graph),
    [workflowEditor.graph],
  );

  const statusText = useMemo(() => {
    if (!projectForEditor) return '';
    if (workflowSummary.blockingReason) {
      return `现在：${workflowSummary.statusHeadline}，卡在${workflowSummary.blockingReason}`;
    }
    return `现在：${workflowSummary.statusHeadline}`;
  }, [projectForEditor, workflowSummary]);

  if (query.isLoading) {
    return <LoadingListSkeleton rows={4} />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message={toUserErrorMessage(query.error, '没加载出来，请再试一次。')}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (!query.data) {
    return <ErrorState title="找不到这个项目" message="链接可能不对，或演示里已经没有这个项目。" />;
  }

  const project = query.data;

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.archived ? '已经结案，只能回看。' : project.overallStage}
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
          { label: project.name },
        ]}
        actions={project.archived ? <Badge variant="secondary">已结案</Badge> : null}
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">概况</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-muted-foreground">还没做完的时间</p>
                {project.upcomingNodeSchedule.length > 0 ? (
                  <p className="flex flex-wrap gap-x-3 gap-y-1">
                    {project.upcomingNodeSchedule.map((s) => (
                      <ScheduleLine key={s.name} name={s.name} dateLabel={s.dateLabel} />
                    ))}
                  </p>
                ) : (
                  <p className="text-muted-foreground">还没排时间。</p>
                )}
              </div>

              {project.finishedNodeSchedule.length > 0 ? (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0 text-muted-foreground"
                    aria-expanded={finishedOpen}
                    onClick={() => setFinishedOpen((v) => !v)}
                  >
                    {finishedOpen ? '收起已经做完的' : '展开已经做完的'}
                    <ChevronDown
                      className={cn('size-4', finishedOpen && 'rotate-180')}
                      aria-hidden
                    />
                  </Button>
                  {finishedOpen ? (
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                      {project.finishedNodeSchedule.map((s) => (
                        <ScheduleLine key={s.name} name={s.name} dateLabel={s.dateLabel} />
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <p>
                <span className="text-muted-foreground">做到哪一步：</span>
                {project.overallStage}
              </p>
              {workflowSummary.inProgressNodeNames.length > 0 ? (
                <p data-testid="summary-in-progress">
                  <span className="text-muted-foreground">正在做：</span>
                  {workflowSummary.inProgressNodeNames.join('、')}
                </p>
              ) : null}
              {workflowSummary.mainBlockingItem ? (
                <p data-testid="summary-blocking-item">
                  <span className="text-muted-foreground">卡在：</span>
                  {workflowSummary.mainBlockingItem}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-6">
                <p>
                  <span className="text-muted-foreground">到手金额：</span>
                  {formatYuan(project.netAmountYuan)}
                </p>
                <p>
                  <span className="text-muted-foreground">返点金额：</span>
                  {formatYuan(project.rebateAmountYuan)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">现在怎样</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm" data-testid="summary-status-text">
                {statusText}
              </p>
              <PublishPanel
                project={project}
                override={publishOverride}
                onPublished={setPublishOverride}
              />
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">待办</CardTitle>
            </CardHeader>
            <CardContent>
              {project.openItems.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {project.openItems.map((item) => (
                    <li key={item.id} className="rounded-md border px-3 py-2">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground">下一步：{item.nextAction}</p>
                      {item.plannedTime ? (
                        <p className="text-muted-foreground">{item.plannedTime}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">没有待办。</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">完整工作流图</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              在此推进或回退节点、标记阻塞、增删节点与连接（演示数据，刷新后恢复）。
            </p>
          </CardHeader>
          <CardContent>
            {project.archived ? (
              <WorkflowGraphReadonly graph={project.workflow} />
            ) : (
              <WorkflowGraphEditor editor={workflowEditor} />
            )}
          </CardContent>
        </Card>

        <Button variant="outline" asChild>
          <Link to="/projects">回到项目列表</Link>
        </Button>
      </div>
    </>
  );
}
