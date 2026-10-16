import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { PanelRight, Pencil } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export type StageNodeData = { name: string };
export type JunctionNodeData = { kind: 'merge' };

export type MockDetail = { open: boolean; status: string; reason: string };

export type NodeUi = {
  editingId: string | null;
  startEdit: (id: string) => void;
  commitEdit: (id: string, value: string) => void;
  cancelEdit: (id: string) => void;
  toggleDetail: (id: string) => void;
  detail: (id: string) => MockDetail;
  mockAction: (id: string, action: 'forward' | 'block' | 'done') => void;
  setReason: (id: string, reason: string) => void;
};

export const NodeUiContext = createContext<NodeUi | null>(null);

const emptyDetail: MockDetail = { open: false, status: '未到', reason: '' };

export function StageNode({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const ui = useContext(NodeUiContext);
  const editing = ui?.editingId === id;
  const detail = ui?.detail(id) ?? emptyDetail;
  const [value, setValue] = useState(data.name);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setValue(data.name);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editing, data.name]);

  return (
    <div
      className={
        selected
          ? 'workflow-stage workflow-pop group relative w-fit min-w-[7.5rem] max-w-[200px] break-all rounded border border-[#e8b15a] bg-[#2a2a2a] px-3 py-2 text-[13px] text-[#f4f4f4] shadow-[0_0_0_1px_#e8b15a]'
          : 'workflow-stage workflow-pop group relative w-fit min-w-[7.5rem] max-w-[200px] break-all rounded border border-[#454545] bg-[#2a2a2a] px-3 py-2 text-[13px] text-[#f4f4f4]'
      }
      data-workflow-node="stage"
    >
      <Handle type="target" position={Position.Left} id="in" isConnectable />
      {editing ? (
        <textarea
          ref={inputRef}
          value={value}
          aria-label="名称"
          rows={2}
          data-testid="workflow-node-name"
          placeholder="名称"
          className="nodrag nowheel workflow-edit-in w-full resize-none bg-transparent text-[13px] leading-snug text-[#f4f4f4] outline-none placeholder:text-[#8a8a8a]"
          onChange={(event) => setValue(event.target.value)}
          onMouseDown={(event) => event.stopPropagation()}
          onBlur={() => ui?.commitEdit(id, value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              ui?.commitEdit(id, value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              ui?.cancelEdit(id);
            }
          }}
        />
      ) : (
        <p className="workflow-edit-in break-all whitespace-normal leading-snug">{data.name}</p>
      )}
      {editing ? null : (
        <>
          <button
            type="button"
            aria-label="修改名称"
            data-testid="workflow-node-edit"
            className="nodrag absolute -right-1 -top-1 flex size-4 items-center justify-center rounded bg-[#3a3a3a] text-[#f4f4f4] opacity-0 transition-opacity duration-150"
            onClick={(event) => {
              event.stopPropagation();
              ui?.startEdit(id);
            }}
          >
            <Pencil className="size-2.5" />
          </button>
          <button
            type="button"
            aria-label="展开"
            data-testid="workflow-node-expand"
            className="nodrag absolute top-1/2 -right-3 flex size-4 -translate-y-1/2 items-center justify-center rounded-full border border-[#666] bg-[#2a2a2a] text-[#f4f4f4] opacity-0 transition-opacity duration-150"
            onClick={(event) => {
              event.stopPropagation();
              ui?.toggleDetail(id);
            }}
          >
            <PanelRight className="size-2.5" />
          </button>
        </>
      )}
      {detail.open ? (
        <div
          data-testid="workflow-node-detail"
          className="nodrag workflow-edit-in absolute top-0 left-full z-20 ml-3 w-40 rounded-md border border-border bg-background p-2 text-xs text-foreground shadow-md"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <p className="text-muted-foreground">状态</p>
          <p className="mb-2" data-testid="workflow-node-status">
            {detail.status}
          </p>
          <label className="text-muted-foreground">
            阻塞原因
            <input
              value={detail.reason}
              aria-label="阻塞原因"
              className="mt-1 h-7 w-full rounded border border-input bg-background px-1 text-foreground"
              onChange={(event) => ui?.setReason(id, event.target.value)}
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded border px-1.5 py-0.5"
              onClick={() => ui?.mockAction(id, 'forward')}
            >
              前进
            </button>
            <button
              type="button"
              className="rounded border px-1.5 py-0.5"
              onClick={() => ui?.mockAction(id, 'block')}
            >
              阻塞
            </button>
            <button
              type="button"
              className="rounded border px-1.5 py-0.5"
              onClick={() => ui?.mockAction(id, 'done')}
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} id="out" isConnectable />
    </div>
  );
}

/** Gold dot moves by dragging the body. Ports appear beside it on hover. */
export function JunctionNode() {
  return (
    <div
      data-workflow-junction="anchor"
      aria-hidden
      className="workflow-pop relative cursor-grab"
      style={{ width: 10, height: 10 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        isConnectable
        className="junction-port"
        data-port="in"
        aria-label="in"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable
        isConnectableEnd={false}
        className="junction-port"
        data-port="out"
        aria-label="out"
      />
      <span className="junction-label junction-label-in">in</span>
      <span className="junction-label junction-label-out">out</span>
      <span
        data-junction-core="true"
        className="pointer-events-auto absolute inset-0 rounded-full"
        style={{ backgroundColor: '#e8b15a' }}
      />
    </div>
  );
}
