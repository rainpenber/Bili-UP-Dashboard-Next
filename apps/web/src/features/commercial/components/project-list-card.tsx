import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CommercialProject } from '../types';

export function ProjectListCard({ project }: { project: CommercialProject }) {
  const [open, setOpen] = useState(false);
  const hasExpandable = Boolean(project.blockedNodeName) || project.openItems.length > 0;

  return (
    <article className={cn('rounded-lg border bg-card', project.archived && 'opacity-70')}>
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {project.name}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">当前阶段：{project.stageLabel}</p>
        </div>
        {hasExpandable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 self-start sm:self-center"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '收起' : '展开阻塞与待办'}
            <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
          </Button>
        ) : null}
      </div>
      {open && hasExpandable ? (
        <div className="space-y-3 border-t px-4 py-3 text-sm">
          {project.blockedNodeName ? (
            <p>
              <span className="text-muted-foreground">卡住的节点：</span>
              {project.blockedNodeName}
              {project.blockingReason ? `（${project.blockingReason}）` : null}
            </p>
          ) : null}
          {project.openItems.length > 0 ? (
            <ul className="space-y-2">
              {project.openItems.map((item) => (
                <li key={item.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    {item.isBlocking ? (
                      <Badge variant="destructive" className="text-[10px]">
                        卡流程
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        不卡流程
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-muted-foreground">下一步：{item.nextAction}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">暂无开放待办。</p>
          )}
        </div>
      ) : null}
    </article>
  );
}
