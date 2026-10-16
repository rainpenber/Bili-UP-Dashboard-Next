import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type StageNodeData = { name: string };
export type JunctionNodeData = { kind: 'merge' };

export function StageNode({ data, selected }: NodeProps<Node<StageNodeData>>) {
  return (
    <div
      className={
        selected
          ? 'flex h-10 w-[168px] items-center rounded border border-[#e8b15a] bg-[#2a2a2a] px-3 text-[13px] text-[#f4f4f4] shadow-[0_0_0_1px_#e8b15a]'
          : 'flex h-10 w-[168px] items-center rounded border border-[#454545] bg-[#2a2a2a] px-3 text-[13px] text-[#f4f4f4]'
      }
      data-workflow-node="stage"
    >
      <Handle type="target" position={Position.Left} id="in" isConnectable />
      <span className="truncate">{data.name}</span>
      <Handle type="source" position={Position.Right} id="out" isConnectable />
    </div>
  );
}

/** Invisible edge anchor. No label, no status, no pointer events. */
export function JunctionNode() {
  return (
    <div data-workflow-junction="anchor" aria-hidden className="size-px">
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        isConnectable={false}
        className="pointer-events-none opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        className="pointer-events-none opacity-0"
      />
    </div>
  );
}
