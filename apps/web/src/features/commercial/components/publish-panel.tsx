import { ExternalLink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  parseCreateMonitorTargetRequest,
  parseMonitorExternalInput,
  serializeCreateMonitorTargetRequest,
} from '@studio/contracts';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveOptionalVideoStartAt } from '@/features/monitoring/monitor-start-at-input';
import { formatStartAtDisplay } from '@/lib/datetime-local';
import type { CommercialProject } from '../types';

const STORAGE_PREFIX = 'commercial-mock-publish:';

export type PublishOverride = { bvid: string; goLiveAtLabel: string };

export function readPublishOverride(projectId: string): PublishOverride | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw) as PublishOverride;
  } catch {
    return null;
  }
}

function writePublishOverride(projectId: string, data: PublishOverride) {
  sessionStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(data));
}

function ScheduledMonitorSection({
  projectId,
  defaultBvid,
}: {
  projectId: string;
  defaultBvid: string;
}) {
  const mutations = useMonitorTargetMutations();
  const [bvid, setBvid] = useState(defaultBvid);
  const [startAtLocal, setStartAtLocal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const parsedId = parseMonitorExternalInput('video', bvid);
    if (!parsedId.ok) {
      setError(parsedId.message);
      return;
    }
    if (!startAtLocal.trim()) {
      setError('请填写上线时间');
      return;
    }
    const startAtResolved = resolveOptionalVideoStartAt('video', startAtLocal);
    if (!startAtResolved.ok) {
      setError(startAtResolved.message);
      return;
    }
    if (startAtResolved.startAt === undefined) {
      setError('请填写上线时间');
      return;
    }
    try {
      const request = parseCreateMonitorTargetRequest({
        type: 'video',
        externalId: parsedId.externalId,
        intervalMode: 'auto',
        startAt: startAtResolved.startAt,
      });
      const body = serializeCreateMonitorTargetRequest(request);
      mutations.create.mutate(body, {
        onSuccess: (result) => {
          const when = formatStartAtDisplay(result.target.startAt);
          if (result.created) {
            setStatus(`已加入定时监控，将在 ${when} 开始采集`);
          } else {
            setStatus(`该监控项已存在（${result.message}）。计划开始：${when}`);
          }
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : '创建定时监控失败');
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '校验失败');
    }
  };

  return (
    <form
      className="space-y-3 border-t pt-3"
      data-testid={`publish-scheduled-monitor-${projectId}`}
      onSubmit={onCreate}
    >
      <p className="text-sm font-medium">定时监控</p>
      <p className="text-xs text-muted-foreground">
        用 BV 与上线时间创建视频定时监控；到点才开始采集。与上方演示发布互不影响，也不会真正投稿。
      </p>
      <div className="space-y-2">
        <Label htmlFor={`monitor-bvid-${projectId}`}>BV 号</Label>
        <Input
          id={`monitor-bvid-${projectId}`}
          data-testid="publish-monitor-bvid"
          value={bvid}
          onChange={(e) => setBvid(e.target.value)}
          placeholder="例如 BV1xxxxxxxxxx"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`monitor-start-${projectId}`}>上线时间</Label>
        <Input
          id={`monitor-start-${projectId}`}
          type="datetime-local"
          data-testid="publish-monitor-start-at"
          value={startAtLocal}
          onChange={(e) => setStartAtLocal(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {status ? (
        <p
          role="status"
          data-testid="publish-monitor-status"
          className="text-sm text-muted-foreground"
        >
          {status}
        </p>
      ) : null}
      <Button type="submit" variant="outline" size="sm" disabled={mutations.create.isPending}>
        {mutations.create.isPending ? '正在创建' : '按此时间创建定时监控'}
      </Button>
    </form>
  );
}

export function PublishPanel({
  project,
  override,
  onPublished,
}: {
  project: CommercialProject;
  override: PublishOverride | null;
  onPublished: (data: PublishOverride) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [bvid, setBvid] = useState(override?.bvid ?? project.bvid ?? '');
  const [goLive, setGoLive] = useState(override?.goLiveAtLabel ?? project.goLiveAtLabel ?? '');

  const isPublished = project.published || Boolean(override);
  const displayBvid = override?.bvid ?? project.bvid;
  const displayGoLive = override?.goLiveAtLabel ?? project.goLiveAtLabel;
  const monitorDefaultBvid = displayBvid ?? bvid ?? '';

  if (project.archived) {
    return <p className="text-sm text-muted-foreground">该项目已归档，发布信息仅供查看。</p>;
  }

  if (isPublished && !editing) {
    return (
      <div className="space-y-3 text-sm">
        <p>
          <span className="font-medium text-success">已上线</span>
          {displayGoLive ? ` · ${displayGoLive}` : null}
        </p>
        {displayBvid ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/monitoring/videos/${displayBvid}`}>
              查看视频数据
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </Button>
        ) : null}
        <ScheduledMonitorSection projectId={project.id} defaultBvid={monitorDefaultBvid} />
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <Button type="button" onClick={() => setEditing(true)}>
          进入发布状态
        </Button>
        <ScheduledMonitorSection projectId={project.id} defaultBvid={monitorDefaultBvid} />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmedBvid = bvid.trim();
          const trimmedGoLive = goLive.trim();
          if (!trimmedBvid || !trimmedGoLive) return;
          const data = { bvid: trimmedBvid, goLiveAtLabel: trimmedGoLive };
          writePublishOverride(project.id, data);
          onPublished(data);
          setEditing(false);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={`bvid-${project.id}`}>BV 号</Label>
          <Input
            id={`bvid-${project.id}`}
            value={bvid}
            onChange={(e) => setBvid(e.target.value)}
            placeholder="例如 BV1xxxxxxxxxx"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`golive-${project.id}`}>上线时间</Label>
          <Input
            id={`golive-${project.id}`}
            value={goLive}
            onChange={(e) => setGoLive(e.target.value)}
            placeholder="例如 2026年3月15日 18:00"
            required
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">确认发布（演示）</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          此处仅在本机浏览器里记住演示状态，不会真的投稿或改后台。
        </p>
      </form>
      <ScheduledMonitorSection projectId={project.id} defaultBvid={bvid || monitorDefaultBvid} />
    </div>
  );
}
