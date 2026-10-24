import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useStudioOwnerAccountQuery,
  useUpdateStudioOwnerAccountMutation,
} from '@/api/hooks/use-studio-owner-queries';
import { MonitorRequestError } from '@/api/monitor-targets-client';

export function StudioOwnerSettingsForm() {
  const query = useStudioOwnerAccountQuery();
  const mutation = useUpdateStudioOwnerAccountMutation();
  const [mid, setMid] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setMid(query.data.mid);
      setDisplayName(query.data.displayName);
    }
  }, [query.data]);

  const pending = query.isLoading || mutation.isPending;
  const errorMessage =
    localError ??
    (mutation.error instanceof Error
      ? mutation.error.message
      : query.error instanceof Error
        ? query.error.message
        : null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const trimmedMid = mid.trim();
    const trimmedName = displayName.trim();
    if (!trimmedMid) {
      setLocalError('请填写本人 B 站 UID');
      return;
    }
    if (!trimmedName) {
      setLocalError('请填写本人账号显示名');
      return;
    }
    mutation.mutate(
      { mid: trimmedMid, displayName: trimmedName },
      {
        onError: (err) => {
          if (err instanceof MonitorRequestError) setLocalError(err.message);
          else if (err instanceof Error) setLocalError(err.message);
          else setLocalError('保存失败');
        },
      },
    );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={onSubmit}
      data-testid="studio-owner-settings-form"
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        用于监控列表「只看我的」筛选，按本人 B 站 UID 精确匹配视频归属。与登录鉴权无关；UID 不在本地
        creators 表也可保存，筛选结果可能为空。
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="studio-owner-display-name">显示名</Label>
        <Input
          id="studio-owner-display-name"
          data-testid="studio-owner-display-name"
          value={displayName}
          disabled={pending}
          placeholder="狐正正"
          onChange={(event) => {
            setDisplayName(event.target.value);
            setLocalError(null);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="studio-owner-mid">B 站 UID</Label>
        <Input
          id="studio-owner-mid"
          data-testid="studio-owner-mid"
          inputMode="numeric"
          autoComplete="off"
          value={mid}
          disabled={pending}
          placeholder="3493141386627335"
          onChange={(event) => {
            setMid(event.target.value);
            setLocalError(null);
          }}
        />
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive" data-testid="studio-owner-error">
          {errorMessage}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="studio-owner-saved">
          已保存。监控列表「只看我的」将使用新的 UID。
        </p>
      ) : null}
      <Button type="submit" disabled={pending} data-testid="studio-owner-save">
        {mutation.isPending ? '保存中…' : '保存本人账号'}
      </Button>
    </form>
  );
}
