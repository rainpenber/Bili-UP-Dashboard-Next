import type { CommercialOpenItemRead } from '@studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { liveInstantLabel } from '../commercial-live-selectors';

const ACTOR_LABEL = { us: '我方', client: '甲方' } as const;
const LIFECYCLE_LABEL = { open: '开放', closed: '已关闭', cancelled: '已取消' } as const;

export function OpenItemsReadout({ items }: { items: CommercialOpenItemRead[] }) {
  return (
    <Card data-testid="project-open-items">
      <CardHeader>
        <CardTitle className="text-base">事项</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有事项记录。</p>
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
                  <Badge variant="secondary">{ACTOR_LABEL[item.nextActor]}</Badge>
                  <Badge variant="outline">{LIFECYCLE_LABEL[item.lifecycle]}</Badge>
                  <Badge variant={item.impact === 'blocking' ? 'destructive' : 'secondary'}>
                    {item.impact === 'blocking' ? '卡流程' : '不卡流程'}
                  </Badge>
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
