import type { WorkflowGraph } from '@studio/contracts';
import { Button } from '@/components/ui/button';

type Props = {
  nodes: WorkflowGraph['nodes'];
  edges: WorkflowGraph['edges'];
  statusColor: Record<string, string>;
  onAdvance: (nodeId: string) => void;
  advancing: boolean;
};

export function WorkflowGraphView({ nodes, edges, statusColor, onAdvance, advancing }: Props) {
  const width = 720;
  const height = Math.max(...nodes.map((n) => n.posY), 600) + 120;

  return (
    <div className="overflow-auto rounded-md border bg-background p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-h-[420px] w-full max-w-full">
        {edges.map((e) => {
          const from = nodes.find((n) => n.id === e.fromNodeId);
          const to = nodes.find((n) => n.id === e.toNodeId);
          if (!from || !to) return null;
          return (
            <line
              key={e.id}
              x1={from.posX + 80}
              y1={from.posY + 40}
              x2={to.posX + 80}
              y2={to.posY}
              stroke="currentColor"
              className="text-border"
              strokeWidth={2}
            />
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            id={`node-${n.id}`}
            tabIndex={-1}
            transform={`translate(${n.posX}, ${n.posY})`}
          >
            <rect
              width={160}
              height={56}
              rx={8}
              className={statusColor[n.status] ?? statusColor.not_reached}
            />
            <text x={8} y={22} className="fill-foreground text-[11px]">
              {n.name}
            </text>
            <text x={8} y={40} className="fill-muted-foreground text-[10px]">
              {n.status}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2">
        {nodes
          .filter((n) => n.status === 'in_progress')
          .map((n) => (
            <Button
              key={n.id}
              type="button"
              size="sm"
              disabled={advancing}
              onClick={() => onAdvance(n.id)}
            >
              {advancing ? '更新中…' : `完成 ${n.name}`}
            </Button>
          ))}
      </div>
    </div>
  );
}
