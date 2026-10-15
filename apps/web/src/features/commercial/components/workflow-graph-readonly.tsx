import type { WorkflowGraph } from '../types';
import { cn } from '@/lib/utils';
import { WorkflowGraphCanvasProvider } from './workflow-graph-canvas';

const LEGEND = [
  { label: '已完成', className: 'border-emerald-600 bg-emerald-100' },
  { label: '进行中', className: 'border-amber-600 bg-amber-100' },
  { label: '被卡住', className: 'border-red-600 bg-red-100' },
  { label: '未到', className: 'border-zinc-400 bg-zinc-100' },
  { label: '不适用', className: 'border-zinc-500 bg-zinc-200' },
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
