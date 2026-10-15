import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommercialProjectListItem } from '@studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { overallStageLabel, stageSummary } from '../commercial-view';

export function ProjectListCard({ project }: { project: CommercialProjectListItem }) {
  const [open, setOpen] = useState(false);
  const expandable = project.anyNodeBlocked || project.currentStageNames.length > 0;

  return (
    <article
      className={cn(
        'rounded-lg border bg-card',
        project.overallStage === 'archived' && 'opacity-70',
      )}
      data-testid={`project-card-${project.id}`}
    >
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {project.name}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">当前阶段：{stageSummary(project)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          {project.anyNodeBlocked ? <Badge variant="destructive">有节点阻塞</Badge> : null}
          {project.overallStage === 'archived' ? <Badge variant="secondary">已归档</Badge> : null}
          {expandable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? '收起' : '展开当前节点'}
              <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {open && expandable ? (
        <div className="space-y-2 border-t px-4 py-3 text-sm">
          <p>
            <span className="text-muted-foreground">整体阶段：</span>
            {overallStageLabel(project.overallStage)}
          </p>
          <p>
            <span className="text-muted-foreground">进行中或阻塞的节点：</span>
            {project.currentStageNames.length > 0 ? project.currentStageNames.join('、') : '无'}
          </p>
        </div>
      ) : null}
    </article>
  );
}
