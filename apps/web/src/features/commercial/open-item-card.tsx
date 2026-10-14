import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OpenItemDto, WorkflowGraph } from '@studio/contracts';
import {
  cancelOpenItem,
  closeOpenItem,
  fetchOpenItemHistory,
  patchOpenItem,
  pinPrimaryBlock,
  promoteOpenItemToNode,
  splitOpenItem,
} from '@/api/commercial-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildOpenItemPatchBody } from '@/features/commercial/open-item-patch-body';
import { auditActionLabel, auditSourceLabel } from '@/lib/commercial-labels';
import { formatFullLocalTime } from '@/lib/format-time';

type Props = {
  projectId: string;
  item: OpenItemDto;
  workflow: WorkflowGraph | null;
  disabled: boolean;
  mergeSelection?: string[];
  onToggleMerge?: (itemId: string) => void;
};

function HistoryBlock({ projectId, itemId }: { projectId: string; itemId: string }) {
  const history = useQuery({
    queryKey: ['commercial', 'item-history', projectId, itemId],
    queryFn: () => fetchOpenItemHistory(projectId, itemId),
  });
  if (history.isLoading) return <p className="text-muted-foreground text-xs">加载历史…</p>;
  if (!history.data?.length) return <p className="text-muted-foreground text-xs">暂无审计历史</p>;
  return (
    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
      {history.data.map((h, i) => (
        <li key={`${h.createdAt}-${i}`}>
          {formatFullLocalTime(h.createdAt)} · {auditActionLabel(h.action)} ·{' '}
          {auditSourceLabel(h.source)}
        </li>
      ))}
    </ul>
  );
}

export function OpenItemCard({
  projectId,
  item,
  workflow,
  disabled,
  mergeSelection,
  onToggleMerge,
}: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [closeCriteria, setCloseCriteria] = useState(item.closeCriteria ?? '');
  const [nextAction, setNextAction] = useState(item.nextAction ?? '');
  const [nextActor, setNextActor] = useState(item.nextActor);
  const [impact, setImpact] = useState(item.impact);
  const [blocksNodeId, setBlocksNodeId] = useState(item.blocksNodeId ?? '');
  const [workflowNodeId, setWorkflowNodeId] = useState(item.workflowNodeId ?? '');
  const [closeConclusion, setCloseConclusion] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [splitTitles, setSplitTitles] = useState('');
  const [promoteName, setPromoteName] = useState('');
  const [expanded, setExpanded] = useState(false);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['commercial'] });

  const patchMut = useMutation({
    mutationFn: () =>
      patchOpenItem(
        projectId,
        item.id,
        buildOpenItemPatchBody({
          title,
          description,
          closeCriteria,
          nextAction,
          nextActor,
          impact,
          blocksNodeId,
          workflowNodeId,
        }),
      ),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });

  const closeMut = useMutation({
    mutationFn: () => closeOpenItem(projectId, item.id, closeConclusion.trim()),
    onSuccess: invalidate,
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelOpenItem(projectId, item.id, cancelReason.trim()),
    onSuccess: invalidate,
  });

  const splitMut = useMutation({
    mutationFn: () =>
      splitOpenItem(
        projectId,
        item.id,
        splitTitles
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    onSuccess: () => {
      setSplitTitles('');
      invalidate();
    },
  });

  const promoteMut = useMutation({
    mutationFn: () => promoteOpenItemToNode(projectId, item.id, { nodeName: promoteName.trim() }),
    onSuccess: () => {
      setPromoteName('');
      invalidate();
    },
  });

  const pinMut = useMutation({
    mutationFn: () => pinPrimaryBlock(projectId, item.id),
    onSuccess: invalidate,
  });

  const pending =
    patchMut.isPending ||
    closeMut.isPending ||
    cancelMut.isPending ||
    splitMut.isPending ||
    promoteMut.isPending ||
    pinMut.isPending ||
    disabled;
  const err =
    (patchMut.error ??
    closeMut.error ??
    cancelMut.error ??
    splitMut.error ??
    promoteMut.error ??
    pinMut.error)
      ? (
          (patchMut.error ??
            closeMut.error ??
            cancelMut.error ??
            splitMut.error ??
            promoteMut.error ??
            pinMut.error) as Error
        ).message
      : null;

  if (item.lifecycle !== 'open') {
    return (
      <div
        id={`item-${item.id}`}
        tabIndex={0}
        className="rounded border p-2 text-sm outline-none focus:ring-2"
      >
        <button
          type="button"
          className="w-full text-left font-medium"
          onClick={() => setExpanded((v) => !v)}
        >
          {item.title}（{item.lifecycle === 'closed' ? '已闭环' : '已取消'}）
          {item.lifecycle === 'closed' && item.closeConclusion
            ? ` · ${item.closeConclusion}`
            : null}
          {item.lifecycle === 'cancelled' && item.cancelReason ? ` · ${item.cancelReason}` : null}
        </button>
        {expanded ? <HistoryBlock projectId={projectId} itemId={item.id} /> : null}
      </div>
    );
  }

  return (
    <div
      id={`item-${item.id}`}
      tabIndex={0}
      className="rounded border p-2 outline-none focus:ring-2"
    >
      {onToggleMerge ? (
        <label className="mb-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="参与合并"
            checked={mergeSelection?.includes(item.id) ?? false}
            onChange={() => onToggleMerge(item.id)}
          />
          参与合并
        </label>
      ) : null}
      {editing ? (
        <div className="space-y-2 text-sm">
          <Input aria-label="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            aria-label="说明"
            placeholder="说明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            aria-label="闭环标准"
            placeholder="闭环标准"
            value={closeCriteria}
            onChange={(e) => setCloseCriteria(e.target.value)}
          />
          <Input
            aria-label="下一步动作"
            placeholder="下一步动作"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
          />
          <label className="flex items-center gap-2">
            行动方
            <select
              className="rounded border px-2 py-1"
              value={nextActor}
              onChange={(e) => setNextActor(e.target.value as 'us' | 'client')}
            >
              <option value="us">我方</option>
              <option value="client">甲方</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            影响
            <select
              className="rounded border px-2 py-1"
              value={impact}
              onChange={(e) => setImpact(e.target.value as 'normal' | 'blocking')}
            >
              <option value="normal">普通</option>
              <option value="blocking">阻塞</option>
            </select>
          </label>
          {impact === 'blocking' ? (
            <label className="flex flex-col gap-1">
              阻塞节点
              <select
                className="rounded border px-2 py-1"
                value={blocksNodeId}
                onChange={(e) => setBlocksNodeId(e.target.value)}
              >
                <option value="">请选择节点</option>
                {workflow?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            关联节点（可选）
            <select
              className="rounded border px-2 py-1"
              value={workflowNodeId}
              onChange={(e) => setWorkflowNodeId(e.target.value)}
            >
              <option value="">无</option>
              {workflow?.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          {err ? <p className="text-destructive text-xs">{err}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !title.trim()}
              onClick={() => patchMut.mutate()}
            >
              {patchMut.isPending ? '保存中…' : '保存'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消编辑
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-medium">{item.title}</p>
          <p className="text-muted-foreground">
            {item.nextAction ?? '暂无下一步'} · {item.nextActor === 'us' ? '我方' : '甲方'} ·{' '}
            {item.impact === 'blocking' ? '阻塞' : '普通'}
          </p>
          {item.description ? (
            <p className="text-muted-foreground mt-1">{item.description}</p>
          ) : null}
          {err ? <p className="text-destructive text-xs">{err}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              编辑
            </Button>
            {item.impact === 'blocking' && item.blocksNodeId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => pinMut.mutate()}
              >
                {pinMut.isPending ? '处理中…' : '设为主要阻塞'}
              </Button>
            ) : null}
            <Input
              className="max-w-xs"
              aria-label="闭环结论"
              placeholder="闭环结论"
              value={closeConclusion}
              onChange={(e) => setCloseConclusion(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || !closeConclusion.trim()}
              onClick={() => closeMut.mutate()}
            >
              {closeMut.isPending ? '闭环中…' : '闭环'}
            </Button>
            <Input
              className="max-w-xs"
              aria-label="取消原因"
              placeholder="取消原因"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending || !cancelReason.trim()}
              onClick={() => cancelMut.mutate()}
            >
              取消事项
            </Button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs">拆分 / 提升为节点</summary>
            <div className="mt-2 space-y-2">
              <textarea
                className="w-full rounded border p-2 text-sm"
                aria-label="拆分标题"
                placeholder="每行一条新事项标题"
                value={splitTitles}
                onChange={(e) => setSplitTitles(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !splitTitles.trim()}
                onClick={() => splitMut.mutate()}
              >
                拆分
              </Button>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="新节点名称"
                  placeholder="提升为节点名称"
                  value={promoteName}
                  onChange={(e) => setPromoteName(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || !promoteName.trim()}
                  onClick={() => promoteMut.mutate()}
                >
                  提升为节点
                </Button>
              </div>
            </div>
          </details>
          <HistoryBlock projectId={projectId} itemId={item.id} />
        </>
      )}
    </div>
  );
}
