import type { WorkflowGraph } from '../types';
import { cn } from '@/lib/utils';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';

const LEGEND = [
  { label: '已完成', className: 'border-success/50 bg-success/15' },
  { label: '进行中', className: 'border-warning/50 bg-warning/15' },
  { label: '被卡住', className: 'border-destructive/50 bg-destructive/15' },
  { label: '未到', className: 'border-border bg-muted/40' },
] as const;

export function WorkflowGraphReadonly({ graph }: { graph: WorkflowGraph }) {
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="流程图图例">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', item.className)} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
      <WorkflowGraphCanvasProvider graph={graph} selectedNodeId={null} onSelectNode={() => {}} />
    </div>
  );
}
