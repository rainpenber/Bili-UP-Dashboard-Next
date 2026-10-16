import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  if (project.archived) {
    return <p className="text-sm text-muted-foreground">已经结案，发布信息只能看。</p>;
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
      </div>
    );
  }

  if (!editing) {
    return (
      <Button type="button" onClick={() => setEditing(true)}>
        标成已发布
      </Button>
    );
  }

  return (
    <form
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
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
        <Button type="submit">确认已发布</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">只记在这台浏览器里，不会真的投稿。</p>
    </form>
  );
}
