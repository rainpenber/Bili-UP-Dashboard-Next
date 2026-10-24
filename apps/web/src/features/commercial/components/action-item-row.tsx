import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { liveInstantLabel, type LiveActionItem } from '../commercial-live-selectors';

export function ActionItemRow({
  item,
  projectName,
}: {
  item: LiveActionItem;
  projectName: string;
}) {
  return (
    <Link
      to={`/projects/${item.projectId}`}
      className="group flex flex-col gap-1 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
      data-testid="home-action"
      data-project-id={item.projectId}
      data-actor={item.nextActor}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs text-muted-foreground">{projectName}</p>
        <p className="font-medium text-foreground">{item.title}</p>
        <p className="text-sm text-muted-foreground">下一步：{item.nextAction ?? '未填写'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <span>计划时间：{liveInstantLabel(item.plannedAt, '未定')}</span>
        <ChevronRight
          className="size-4 opacity-60 transition group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </Link>
  );
}
