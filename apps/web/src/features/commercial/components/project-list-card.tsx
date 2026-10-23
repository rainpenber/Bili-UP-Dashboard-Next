import type { CommercialProjectListItem } from '@studio/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { businessStateListBadge } from '../business-display-state';
import { unarchiveLiveProject } from '../commercial-live-api';
import {
  isArchivedLiveProject,
  liveInstantLabel,
  liveStageLabel,
} from '../commercial-live-selectors';
import { liveCommercialProjectsKey } from '../use-live-workflow';

const LIFECYCLE_LABEL = { open: '开放', closed: '已关闭', cancelled: '已取消' } as const;
const ACTOR_LABEL = { us: '我方', client: '甲方' } as const;

export function ProjectListCard({ project }: { project: CommercialProjectListItem }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const archived = isArchivedLiveProject(project);
  const softArchived = project.archivedAt !== null;
  const hasBlock = project.anyNodeBlocked || project.blockedNodeNames.length > 0;
  const hasExpandable = hasBlock || project.openItems.length > 0;
  const displayBadge = businessStateListBadge(project.businessState, project.originStatusLabel);
  const weakenStage =
    project.businessState === 'not_started' || project.businessState === 'finished';

  const onRestore = () => {
    setRestoring(true);
    setRestoreError(null);
    void unarchiveLiveProject(project.id)
      .then(() => queryClient.invalidateQueries({ queryKey: liveCommercialProjectsKey }))
      .catch((err: unknown) => {
        setRestoreError(err instanceof Error ? err.message : '恢复失败');
      })
      .finally(() => setRestoring(false));
  };

  return (
    <article
      className={cn('rounded-lg border bg-card', archived && 'opacity-70')}
      data-testid="project-list-card"
      data-project-id={project.id}
      data-archived={archived ? 'true' : 'false'}
      data-business-state={project.businessState ?? ''}
    >
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/projects/${project.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {project.name}
            </Link>
            {archived ? <Badge variant="secondary">已归档</Badge> : null}
            {project.overallStage === 'closed' ? <Badge variant="outline">已结案</Badge> : null}
            {displayBadge ? (
              <Badge
                variant={displayBadge.tone === 'finished' ? 'secondary' : 'outline'}
                className={cn(
                  'text-[11px]',
                  displayBadge.tone === 'finished' && 'border-emerald-600/30 text-emerald-800',
                  displayBadge.tone === 'not_started' && 'text-muted-foreground',
                )}
                data-testid="project-business-state-badge"
                data-tone={displayBadge.tone}
              >
                {displayBadge.text}
              </Badge>
            ) : null}
          </div>
          <p
            className={cn(
              'mt-1 text-sm',
              weakenStage ? 'text-muted-foreground/70' : 'text-muted-foreground',
            )}
            data-testid="project-list-stage-line"
            data-weakened={weakenStage ? 'true' : 'false'}
          >
            当前阶段：{liveStageLabel(project)}
          </p>
          {restoreError ? (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {restoreError}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
          {softArchived ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={restoring}
              onClick={onRestore}
              data-testid="project-list-unarchive"
            >
              {restoring ? '恢复中…' : '恢复'}
            </Button>
          ) : null}
          {hasExpandable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '收起' : '展开阻塞与待办'}
              <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {open && hasExpandable ? (
        <div className="space-y-3 border-t px-4 py-3 text-sm" data-testid="project-list-detail">
          {hasBlock ? (
            <div className="space-y-1">
              <p>
                <span className="text-muted-foreground">卡住的节点：</span>
                {project.blockedNodeNames.length > 0
                  ? project.blockedNodeNames.join('、')
                  : '无节点名'}
              </p>
              <p>
                <span className="text-muted-foreground">阻塞原因：</span>
                {project.blockingReason ?? '未记录'}
              </p>
              <p>
                <span className="text-muted-foreground">对外时间：</span>
                {liveInstantLabel(project.userDeadlineAt, '未定')}
              </p>
              <p>
                <span className="text-muted-foreground">阻塞开始：</span>
                {liveInstantLabel(project.blockedSinceAt, '未记录')}
              </p>
            </div>
          ) : null}
          {project.openItems.length > 0 ? (
            <ul className="space-y-2">
              {project.openItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md bg-muted/40 px-3 py-2"
                  data-testid="project-list-item"
                  data-lifecycle={item.lifecycle}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {ACTOR_LABEL[item.nextActor]}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {LIFECYCLE_LABEL[item.lifecycle]}
                    </Badge>
                    {item.impact === 'blocking' ? (
                      <Badge variant="destructive" className="text-[10px]">
                        卡流程
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        不卡流程
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    下一步：{item.nextAction ?? '未填写'}
                  </p>
                  <p className="text-muted-foreground">
                    计划时间：{liveInstantLabel(item.plannedAt, '未定')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">没有事项记录。</p>
          )}
        </div>
      ) : null}
    </article>
  );
}
