import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ChevronDown } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FlowDirection } from './layout';
import { STAGE_H, STAGE_W } from './model';

export type StageNodeData = { name: string };
export type JunctionNodeData = { kind: 'merge' };

export type MockStatus = 'idle' | 'active' | 'blocked' | 'done';

export type MockDetail = { open: boolean; status: MockStatus; reason: string };

const STATUS_CHOICES: { id: MockStatus; label: string }[] = [
  { id: 'idle', label: '未完成' },
  { id: 'active', label: '进行中' },
  { id: 'blocked', label: '阻塞' },
  { id: 'done', label: '完成' },
];

export type NodeUi = {
  editingId: string | null;
  startEdit: (id: string) => void;
  commitEdit: (id: string, value: string) => void;
  cancelEdit: (id: string) => void;
  toggleDetail: (id: string) => void;
  detail: (id: string) => MockDetail;
  setStatus: (id: string, status: MockStatus) => void;
  setReason: (id: string, reason: string) => void;
  direction: FlowDirection;
};

export const NodeUiContext = createContext<NodeUi | null>(null);

const emptyDetail: MockDetail = { open: false, status: 'idle', reason: '' };

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

  const vertical = (ui?.direction ?? 'lr') === 'tb';
  const shown = (editing ? value : data.name) || '名称';
  return (
    <div
      className="w-fit"
      data-stage-align="true"
      style={{
        transform: `translate(calc((${STAGE_W}px - 100%) / 2), calc((${STAGE_H}px - 100%) / 2))`,
      }}
    >
      <div
        className={
          selected
            ? 'workflow-stage workflow-pop group relative w-fit min-w-[7.5rem] max-w-[200px] break-all rounded border bg-[#2a2a2a] px-3 py-2 text-[13px] text-[#f4f4f4] shadow-[0_0_0_1px_#e8b15a]'
            : 'workflow-stage workflow-pop group relative w-fit min-w-[7.5rem] max-w-[200px] break-all rounded border bg-[#2a2a2a] px-3 py-2 text-[13px] text-[#f4f4f4]'
        }
        data-workflow-node="stage"
        data-status={detail.status}
      >
        <Handle
          type="target"
          position={vertical ? Position.Top : Position.Left}
          id="in"
          isConnectable
        />
        <div className="relative">
          <p className={`break-all whitespace-pre-wrap leading-snug ${editing ? 'invisible' : ''}`}>
            {shown}
          </p>
          {editing ? (
            <textarea
              ref={inputRef}
              value={value}
              aria-label="名称"
              rows={1}
              data-testid="workflow-node-name"
              placeholder="名称"
              className="nodrag nowheel workflow-edit-in absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent p-0 text-[13px] leading-snug text-[#f4f4f4] outline-none placeholder:text-[#8a8a8a]"
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
          ) : null}
        </div>
        <button
          type="button"
          aria-label={detail.open ? '收起' : '展开'}
          aria-expanded={detail.open}
          data-testid="workflow-node-expand"
          className={
            detail.open
              ? 'nodrag nopan workflow-node-open absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded border border-[#666] bg-[#3a3a3a] text-[#f4f4f4]'
              : 'nodrag nopan workflow-node-hover absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded border border-[#666] bg-[#3a3a3a] text-[#f4f4f4]'
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            ui?.toggleDetail(id);
          }}
        >
          <ChevronDown className={detail.open ? 'size-3 rotate-180' : 'size-3'} />
        </button>
        {detail.open ? (
          <div
            data-testid="workflow-node-detail"
            className="nodrag nowheel workflow-edit-in mt-2 border-t border-white/15 pt-2 text-[11px] text-[#d8d8d8]"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              role="radiogroup"
              aria-label="状态"
              data-testid="workflow-node-status"
              className="grid grid-cols-4 overflow-hidden rounded border border-white/20"
            >
              {STATUS_CHOICES.map((choice) => {
                const on = detail.status === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-status-choice={choice.id}
                    className="workflow-status-choice nodrag px-0.5 py-1 whitespace-nowrap"
                    onClick={() => ui?.setStatus(id, choice.id)}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
            {detail.status === 'blocked' ? (
              <label className="mt-2 block text-[#9a9a9a]">
                阻塞原因
                <input
                  value={detail.reason}
                  aria-label="阻塞原因"
                  className="nodrag nowheel mt-1 h-7 w-full rounded border border-white/20 bg-[#1b1b1b] px-1 text-[#f4f4f4]"
                  onChange={(event) => ui?.setReason(id, event.target.value)}
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <Handle
          type="source"
          position={vertical ? Position.Bottom : Position.Right}
          id="out"
          isConnectable
        />
      </div>
    </div>
  );
}

/** Gold dot moves by dragging the body. Ports appear beside it on hover. */
export function JunctionNode() {
  const ui = useContext(NodeUiContext);
  const vertical = (ui?.direction ?? 'lr') === 'tb';
  return (
    <div
      data-workflow-junction="anchor"
      aria-hidden
      className="workflow-pop relative cursor-grab"
      style={{ width: 10, height: 10 }}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        id="in"
        isConnectable
        className="junction-port"
        data-port="in"
        aria-label="in"
      />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
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
