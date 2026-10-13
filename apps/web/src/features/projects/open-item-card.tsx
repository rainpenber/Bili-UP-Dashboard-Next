import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { useProjectMutations } from '@/api/hooks/use-project-queries';
import { formatFullLocalTime } from '@/lib/format-time';
import type { OpenItemDto, TeamMember, WorkflowNodeDto } from '@studio/contracts';
import { openItemTypeSchema, responsiblePartySchema } from '@studio/contracts';
import { buildOpenItemEditPatchBody } from '@/features/projects/open-item-patch';

type Mutations = ReturnType<typeof useProjectMutations>;

type Props = {
  item: OpenItemDto;
  projectId: string;
  nodes: WorkflowNodeDto[];
  members: TeamMember[];
  mutations: Mutations;
  onError: (message: string | null) => void;
};

export function OpenItemCard({ item, projectId, nodes, members, mutations, onError }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [itemType, setItemType] = useState(item.itemType);
  const [party, setParty] = useState(item.responsibleParty);
  const [due, setDue] = useState(item.dueAt ? item.dueAt.slice(0, 16) : '');
  const [closeCondition, setCloseCondition] = useState(item.closeCondition ?? '');
  const [description, setDescription] = useState(item.description ?? '');
  const [nodeId, setNodeId] = useState(item.workflowNodeId ?? '');
  const [humanConfirmed, setHumanConfirmed] = useState(item.humanConfirmed);
  const [confirmedById, setConfirmedById] = useState(item.confirmedBy?.id ?? members[0]?.id ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setTitle(item.title);
    setItemType(item.itemType);
    setParty(item.responsibleParty);
    setDue(item.dueAt ? item.dueAt.slice(0, 16) : '');
    setCloseCondition(item.closeCondition ?? '');
    setDescription(item.description ?? '');
    setNodeId(item.workflowNodeId ?? '');
    setHumanConfirmed(item.humanConfirmed);
    setConfirmedById(item.confirmedBy?.id ?? members[0]?.id ?? '');
  }, [item, editing, members]);

  const pending = mutations.patchOpenItem.isPending;

  const saveEdit = () => {
    setLocalError(null);
    onError(null);
    const built = buildOpenItemEditPatchBody(
      {
        humanConfirmed: item.humanConfirmed,
        confirmedById: item.confirmedBy?.id ?? null,
      },
      {
        title,
        itemType,
        responsibleParty: party,
        description,
        closeCondition,
        workflowNodeId: nodeId,
        dueLocal: due,
        humanConfirmed,
        confirmedById,
      },
    );
    if ('error' in built) {
      setLocalError(built.error);
      return;
    }
    mutations.patchOpenItem
      .mutateAsync({ projectId, itemId: item.id, body: built.body })
      .then(() => setEditing(false))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '保存失败';
        setLocalError(msg);
        onError(msg);
      });
  };

  const patchStatus = (status: 'resolved' | 'cancelled') => {
    setLocalError(null);
    onError(null);
    mutations.patchOpenItem
      .mutateAsync({ projectId, itemId: item.id, body: { status } })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '更新失败';
        setLocalError(msg);
        onError(msg);
      });
  };

  return (
    <div
      id={`item-${item.id}`}
      tabIndex={-1}
      className="rounded-lg border p-3 outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.title}</span>
        <Badge variant="secondary">{item.status}</Badge>
        <Badge variant="outline">{item.itemType}</Badge>
        {!editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            编辑
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`edit-title-${item.id}`}>标题</Label>
            <Input
              id={`edit-title-${item.id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-type-${item.id}`}>类型</Label>
            <Select
              value={itemType}
              onValueChange={(v) => setItemType(v as OpenItemDto['itemType'])}
            >
              <SelectTrigger id={`edit-type-${item.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {openItemTypeSchema.options.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-party-${item.id}`}>责任方</Label>
            <Select
              value={party}
              onValueChange={(v) => setParty(v as OpenItemDto['responsibleParty'])}
            >
              <SelectTrigger id={`edit-party-${item.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {responsiblePartySchema.options.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-due-${item.id}`}>截止时间</Label>
            <Input
              id={`edit-due-${item.id}`}
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-node-${item.id}`}>关联节点</Label>
            <Select
              value={nodeId || 'none'}
              onValueChange={(v) => setNodeId(v === 'none' ? '' : v)}
            >
              <SelectTrigger id={`edit-node-${item.id}`}>
                <SelectValue placeholder="可选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无</SelectItem>
                {nodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`edit-close-${item.id}`}>关闭条件</Label>
            <Input
              id={`edit-close-${item.id}`}
              value={closeCondition}
              onChange={(e) => setCloseCondition(e.target.value)}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`edit-desc-${item.id}`}>说明</Label>
            <Input
              id={`edit-desc-${item.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-confirmed-${item.id}`}>人工确认</Label>
            <Select
              value={humanConfirmed ? 'yes' : 'no'}
              onValueChange={(v) => setHumanConfirmed(v === 'yes')}
            >
              <SelectTrigger id={`edit-confirmed-${item.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">未确认</SelectItem>
                <SelectItem value="yes">已确认</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {humanConfirmed ? (
            <div className="space-y-1">
              <Label htmlFor={`edit-confirmer-${item.id}`}>确认人</Label>
              <Select value={confirmedById || 'none'} onValueChange={setConfirmedById}>
                <SelectTrigger id={`edit-confirmer-${item.id}`}>
                  <SelectValue placeholder="选择成员" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="button" disabled={pending || !title.trim()} onClick={saveEdit}>
              {pending ? '保存中…' : '保存编辑'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            责任方 {item.responsibleParty}
            {item.dueAt ? ` · 截止 ${formatFullLocalTime(item.dueAt)}` : ''}
          </p>
          {item.description ? <p className="text-sm">{item.description}</p> : null}
          {item.closeCondition ? <p className="text-sm">关闭条件：{item.closeCondition}</p> : null}
          <p className="text-xs text-muted-foreground">
            来源 {item.sourceType ?? '—'} · 证据 {item.externalEvidenceRef ?? '—'} · 确认{' '}
            {item.humanConfirmed ? '是' : '否'}
            {item.confirmedBy ? ` · ${item.confirmedBy.displayName}` : ''}
            {item.confirmedAt ? ` (${formatFullLocalTime(item.confirmedAt)})` : ''}
          </p>
          {item.workflowNodeId ? (
            <p className="text-xs text-muted-foreground">
              关联节点{' '}
              {nodes.find((n) => n.id === item.workflowNodeId)?.label ?? item.workflowNodeId}
            </p>
          ) : null}
        </>
      )}

      {localError ? <p className="mt-2 text-sm text-destructive">{localError}</p> : null}

      {item.status === 'open' && !editing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => patchStatus('resolved')}
          >
            {pending ? '处理中…' : '标记已解决'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => patchStatus('cancelled')}
          >
            {pending ? '处理中…' : '取消'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
