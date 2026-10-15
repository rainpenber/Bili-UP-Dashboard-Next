import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { legalNodeCommands, NODE_COMMAND_LABEL, type NodeCommand } from '../node-actions';
import type { WorkflowApiStatus } from '../types';

export type PublishDraft = {
  platform: string;
  video: string;
  idempotencyKey: string;
};

export function NodeActionPanel({
  status,
  isOptional,
  isPublishNode,
  pending,
  onCommand,
  onBlock,
  onPublish,
}: {
  status: WorkflowApiStatus;
  isOptional: boolean;
  isPublishNode: boolean;
  pending: boolean;
  onCommand: (command: Exclude<NodeCommand, 'block' | 'publish'>) => void;
  onBlock: (reason: string | null) => void;
  onPublish: (draft: PublishDraft) => void;
}) {
  const [reason, setReason] = useState('');
  const [platform, setPlatform] = useState('bilibili');
  const [video, setVideo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const commands = legalNodeCommands({ status, isOptional, isPublishNode });

  return (
    <div className="space-y-2" data-testid="workflow-node-actions">
      {commands.map((command) => {
        if (command === 'block') {
          return (
            <div key="block" className="space-y-2 border-t border-border/60 pt-2">
              <Label className="space-y-1 text-xs text-muted-foreground">
                <span>阻塞原因（可以留空）</span>
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="阻塞原因（可选）"
                  className="h-8 text-sm"
                  data-testid="workflow-block-reason-input"
                  aria-label="阻塞原因（可选）"
                  disabled={pending}
                />
              </Label>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-8 w-full text-xs"
                disabled={pending}
                data-testid="workflow-block-submit"
                onClick={() => onBlock(reason.trim().length > 0 ? reason.trim() : null)}
              >
                阻塞
              </Button>
            </div>
          );
        }
        if (command === 'publish') {
          return (
            <form
              key="publish"
              className="space-y-2 border-t border-border/60 pt-2"
              data-testid="publish-form"
              onSubmit={(event) => {
                event.preventDefault();
                const platformValue = platform.trim();
                const videoValue = video.trim();
                if (!platformValue || !videoValue) {
                  setFormError('请填写平台，以及 BV 号或视频链接。');
                  return;
                }
                setFormError(null);
                onPublish({
                  platform: platformValue,
                  video: videoValue,
                  idempotencyKey: crypto.randomUUID(),
                });
              }}
            >
              <p className="text-xs text-muted-foreground">完成发布节点需要记下视频。</p>
              <Label className="space-y-1 text-xs text-muted-foreground">
                <span>平台</span>
                <Input
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                  className="h-8 text-sm"
                  data-testid="publish-platform"
                  disabled={pending}
                />
              </Label>
              <Label className="space-y-1 text-xs text-muted-foreground">
                <span>BV 号或视频链接</span>
                <Input
                  value={video}
                  onChange={(event) => setVideo(event.target.value)}
                  placeholder="BV1… 或 https://www.bilibili.com/video/BV1…"
                  className="h-8 text-sm"
                  data-testid="publish-video"
                  disabled={pending}
                />
              </Label>
              {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
              <Button type="submit" size="sm" className="h-8 w-full text-xs" disabled={pending}>
                完成
              </Button>
            </form>
          );
        }
        return (
          <Button
            key={command}
            type="button"
            size="sm"
            variant={
              command === 'rollback' ? 'secondary' : command === 'skip' ? 'outline' : 'default'
            }
            className="h-8 w-full text-xs"
            disabled={pending}
            data-testid={`workflow-action-${command}`}
            onClick={() => onCommand(command)}
          >
            {NODE_COMMAND_LABEL[command]}
          </Button>
        );
      })}
    </div>
  );
}
