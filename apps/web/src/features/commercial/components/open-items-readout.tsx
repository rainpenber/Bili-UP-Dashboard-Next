import type { CommercialOpenItemRead, OpenItemActor, OpenItemImpact } from '@studio/contracts';
import { OPEN_ITEM_ACTORS } from '@studio/contracts';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  OPEN_ITEM_ACTOR_LABEL,
  OPEN_ITEM_IMPACT_LABEL,
  liveInstantLabel,
} from '../commercial-live-selectors';
import { createLiveOpenItem, updateLiveOpenItem } from '../commercial-live-api';
import { calendarDayKey } from '../node-schedule';

const LIFECYCLE_LABEL = { open: '开放', closed: '已关闭', cancelled: '已取消' } as const;
const IMPACT_OPTIONS: OpenItemImpact[] = ['blocking', 'normal'];

type FormState = {
  itemId: string | null;
  expectedUpdatedAt: string | null;
  title: string;
  nextActor: OpenItemActor;
  impact: OpenItemImpact;
  dueDate: string;
  note: string;
};

function blankForm(): FormState {
  return {
    itemId: null,
    expectedUpdatedAt: null,
    title: '',
    nextActor: 'us',
    impact: 'normal',
    dueDate: '',
    note: '',
  };
}

function formForItem(item: CommercialOpenItemRead): FormState {
  return {
    itemId: item.id,
    expectedUpdatedAt: item.updatedAt,
    title: item.title,
    nextActor: item.nextActor,
    impact: item.impact,
    dueDate: item.plannedAt ? (calendarDayKey(item.plannedAt) ?? '') : '',
    note: item.description ?? '',
  };
}

function dueAtFromDate(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

export function OpenItemsReadout({
  items,
  projectId,
  readOnly = false,
  onChanged,
}: {
  items: CommercialOpenItemRead[];
  projectId?: string;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = Boolean(projectId) && !readOnly;

  const save = async () => {
    if (!form || !projectId) return;
    setSaving(true);
    setError(null);
    const body = {
      title: form.title.trim(),
      nextActor: form.nextActor,
      impact: form.impact,
      dueAt: dueAtFromDate(form.dueDate),
      note: form.note.trim() === '' ? null : form.note.trim(),
    };
    try {
      if (form.itemId && form.expectedUpdatedAt) {
        await updateLiveOpenItem(projectId, form.itemId, {
          expectedUpdatedAt: form.expectedUpdatedAt,
          ...body,
        });
      } else {
        await createLiveOpenItem(projectId, body);
      }
      setForm(null);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <Card data-testid="project-open-items">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">卡点 / 待办</CardTitle>
        {canWrite && !form ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setForm(blankForm());
            }}
            data-testid="open-item-add"
          >
            + 新增卡点
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {form ? (
          <form
            className="space-y-3 rounded-md border bg-muted/20 p-3"
            onSubmit={onSubmit}
            data-testid="open-item-form"
          >
            <div className="space-y-1.5">
              <Label htmlFor="open-item-title">标题</Label>
              <Input
                id="open-item-title"
                value={form.title}
                maxLength={200}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                data-testid="open-item-title-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label>责任方</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="责任方">
                {OPEN_ITEM_ACTORS.map((actor) => (
                  <Button
                    key={actor}
                    type="button"
                    role="radio"
                    aria-checked={form.nextActor === actor}
                    size="sm"
                    variant={form.nextActor === actor ? 'default' : 'outline'}
                    onClick={() =>
                      setForm((current) => (current ? { ...current, nextActor: actor } : current))
                    }
                  >
                    {OPEN_ITEM_ACTOR_LABEL[actor]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>影响</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="影响">
                {IMPACT_OPTIONS.map((impact) => (
                  <Button
                    key={impact}
                    type="button"
                    role="radio"
                    aria-checked={form.impact === impact}
                    size="sm"
                    variant={form.impact === impact ? 'default' : 'outline'}
                    onClick={() =>
                      setForm((current) => (current ? { ...current, impact } : current))
                    }
                  >
                    {OPEN_ITEM_IMPACT_LABEL[impact]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="open-item-due">截止日</Label>
              <Input
                id="open-item-due"
                type="date"
                value={form.dueDate}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, dueDate: event.target.value } : current,
                  )
                }
                data-testid="open-item-due-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="open-item-note">说明</Label>
              <Input
                id="open-item-note"
                value={form.note}
                maxLength={500}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, note: event.target.value } : current,
                  )
                }
                data-testid="open-item-note-input"
              />
            </div>
            {error ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="open-item-form-error"
              >
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={saving} data-testid="open-item-submit">
                {saving ? '保存中…' : '保存'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setForm(null);
                  setError(null);
                }}
                data-testid="open-item-cancel"
              >
                取消
              </Button>
            </div>
          </form>
        ) : null}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有卡点记录。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-md border px-3 py-2"
                data-testid="project-open-item"
                data-lifecycle={item.lifecycle}
                data-actor={item.nextActor}
                data-impact={item.impact}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.title}</p>
                  <Badge variant="secondary">{OPEN_ITEM_ACTOR_LABEL[item.nextActor]}</Badge>
                  <Badge variant="outline">{LIFECYCLE_LABEL[item.lifecycle]}</Badge>
                  <Badge variant={item.impact === 'blocking' ? 'destructive' : 'secondary'}>
                    {item.impact === 'blocking' ? '卡流程' : '不卡流程'}
                  </Badge>
                  {canWrite && item.lifecycle === 'open' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setError(null);
                        setForm(formForItem(item));
                      }}
                      data-testid={`open-item-edit-${item.id}`}
                    >
                      编辑
                    </Button>
                  ) : null}
                </div>
                <p className="text-muted-foreground">下一步：{item.nextAction ?? '未填写'}</p>
                <p className="text-muted-foreground">
                  计划时间：{liveInstantLabel(item.plannedAt, '未定')}
                </p>
                {item.description !== null ? (
                  <p className="text-muted-foreground">{item.description}</p>
                ) : null}
                {item.closeCriteria !== null ? (
                  <p className="text-muted-foreground">关闭标准：{item.closeCriteria}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
