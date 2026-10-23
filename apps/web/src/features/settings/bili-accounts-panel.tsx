import { useState, type FormEvent } from 'react';
import type { BiliAccountExpiryState, BiliAccountListItem } from '@studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MonitorRequestError } from '@/api/monitor-targets-client';
import {
  useBiliAccountsQuery,
  useCreateBiliAccountMutation,
  usePatchBiliAccountMutation,
  useRevokeBiliAccountMutation,
  useVerifyBiliAccountMutation,
} from '@/api/hooks/use-bili-accounts-queries';

function expiryLabel(state: BiliAccountExpiryState): string {
  switch (state) {
    case 'ok':
      return '正常';
    case 'expiring_soon':
      return '即将过期';
    case 'expired':
      return '已过期';
    case 'missing_secret':
      return '缺少凭据';
    case 'revoked':
      return '已撤销';
  }
}

function expiryVariant(
  state: BiliAccountExpiryState,
): 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' {
  switch (state) {
    case 'ok':
      return 'success';
    case 'expiring_soon':
      return 'warning';
    case 'expired':
    case 'missing_secret':
    case 'revoked':
      return 'destructive';
  }
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function AccountCard({
  account,
  realAccessEnabled,
  busy,
  onSetDefault,
  onVerify,
  onRevoke,
}: {
  account: BiliAccountListItem;
  realAccessEnabled: boolean;
  busy: boolean;
  onSetDefault: () => void;
  onVerify: () => void;
  onRevoke: () => void;
}) {
  const revoked = account.status === 'revoked' || account.derivedExpiryState === 'revoked';
  return (
    <article
      className="min-w-0 space-y-3 border-b border-border py-4 last:border-b-0"
      data-testid={`bili-account-card-${account.id}`}
      data-expiry-state={account.derivedExpiryState}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" data-testid="bili-account-uname">
            {account.uname?.trim() || '未命名账号'}
          </p>
          <p className="truncate text-xs text-muted-foreground" data-testid="bili-account-mid">
            mid {account.mid ?? '—'}
          </p>
        </div>
        <Badge variant={expiryVariant(account.derivedExpiryState)} data-testid="bili-account-status">
          {expiryLabel(account.derivedExpiryState)}
        </Badge>
        {account.isDefault ? (
          <Badge variant="info" data-testid="bili-account-default">
            默认
          </Badge>
        ) : null}
      </div>
      <dl className="grid gap-1 text-xs text-muted-foreground">
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0">Cookie 到期</dt>
          <dd className="min-w-0 truncate" data-testid="bili-account-expires">
            {formatTime(account.cookieExpiresAt)}
          </dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0">最后校验</dt>
          <dd className="min-w-0 truncate" data-testid="bili-account-verified">
            {formatTime(account.lastVerifiedAt)}
          </dd>
        </div>
        {account.note ? (
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0">备注</dt>
            <dd className="min-w-0 break-words" data-testid="bili-account-note">
              {account.note}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || revoked || account.isDefault}
          onClick={onSetDefault}
          data-testid="bili-account-set-default"
        >
          设为默认
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || revoked || !realAccessEnabled}
          title={
            realAccessEnabled
              ? undefined
              : 'mock / 未开启真实 B 站访问，不能校验登录态'
          }
          onClick={onVerify}
          data-testid="bili-account-verify"
        >
          重新校验
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy || revoked}
          onClick={onRevoke}
          data-testid="bili-account-revoke"
        >
          撤销
        </Button>
      </div>
    </article>
  );
}

export function BiliAccountsPanel() {
  const query = useBiliAccountsQuery();
  const createMutation = useCreateBiliAccountMutation();
  const patchMutation = usePatchBiliAccountMutation();
  const revokeMutation = useRevokeBiliAccountMutation();
  const verifyMutation = useVerifyBiliAccountMutation();
  const [cookie, setCookie] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<BiliAccountListItem | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const busy =
    createMutation.isPending ||
    patchMutation.isPending ||
    revokeMutation.isPending ||
    verifyMutation.isPending;
  const realAccessEnabled = query.data?.realAccessEnabled ?? false;
  const items = query.data?.items ?? [];

  const errorMessage =
    localError ??
    (createMutation.error instanceof Error
      ? createMutation.error.message
      : patchMutation.error instanceof Error
        ? patchMutation.error.message
        : revokeMutation.error instanceof Error
          ? revokeMutation.error.message
          : verifyMutation.error instanceof Error
            ? verifyMutation.error.message
            : query.error instanceof Error
              ? query.error.message
              : null);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setActionMessage(null);
    if (!cookie.trim()) {
      setLocalError('请粘贴 B 站 Cookie 字符串');
      return;
    }
    const payload: { cookie: string; note?: string } = { cookie: cookie.trim() };
    const trimmedNote = note.trim();
    if (trimmedNote) payload.note = trimmedNote;
    createMutation.mutate(payload, {
      onSuccess: () => {
        setCookie('');
        setNote('');
        setActionMessage('账号已保存（仅存加密副本）');
      },
      onError: (err) => {
        if (err instanceof MonitorRequestError) setLocalError(err.message);
        else if (err instanceof Error) setLocalError(err.message);
        else setLocalError('新增失败');
      },
    });
  };

  return (
    <div className="min-w-0 space-y-4" data-testid="bili-accounts-panel">
      <p className="text-sm text-muted-foreground">
        管理采集用的 B 站登录账号。Cookie 只保存加密副本，接口与日志不会回显明文。撤销会删除凭据并保留账号行供审计。
      </p>
      {!realAccessEnabled ? (
        <p className="text-sm text-muted-foreground" data-testid="bili-accounts-verify-disabled-hint">
          当前为 mock / 未开启真实 B 站访问，「重新校验」已禁用。
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">加载账号列表…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="bili-accounts-empty">
          还没有采集账号。粘贴 Cookie 新增一条即可。
        </p>
      ) : (
        <div className="min-w-0 divide-y-0">
          {items.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              realAccessEnabled={realAccessEnabled}
              busy={busy}
              onSetDefault={() => {
                setLocalError(null);
                setActionMessage(null);
                patchMutation.mutate(
                  { id: account.id, patch: { isDefault: true } },
                  {
                    onSuccess: () => setActionMessage('已设为默认账号'),
                    onError: (err) => {
                      setLocalError(err instanceof Error ? err.message : '设为默认失败');
                    },
                  },
                );
              }}
              onVerify={() => {
                setLocalError(null);
                setActionMessage(null);
                verifyMutation.mutate(account.id, {
                  onSuccess: () => setActionMessage('登录态校验通过'),
                  onError: (err) => {
                    setLocalError(err instanceof Error ? err.message : '校验失败');
                  },
                });
              }}
              onRevoke={() => setRevokeTarget(account)}
            />
          ))}
        </div>
      )}

      <form className="min-w-0 space-y-3 border-t border-border pt-4" onSubmit={onCreate} noValidate>
        <p className="text-sm font-medium text-foreground">新增账号</p>
        <div className="grid gap-1.5">
          <Label htmlFor="bili-account-cookie">Cookie</Label>
          <textarea
            id="bili-account-cookie"
            data-testid="bili-account-cookie-input"
            className="min-h-24 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={cookie}
            disabled={busy}
            placeholder="SESSDATA=...; DedeUserID=...; bili_jct=..."
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setCookie(event.target.value);
              setLocalError(null);
            }}
          />
          <p className="text-xs text-muted-foreground">只保存加密副本，不会在列表或日志中回显明文。</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bili-account-note">备注（可选）</Label>
          <Input
            id="bili-account-note"
            data-testid="bili-account-note-input"
            value={note}
            disabled={busy}
            placeholder="工作室主号 / 备用"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy} data-testid="bili-account-create-submit">
          新增账号
        </Button>
      </form>

      {errorMessage ? (
        <p className="text-sm text-destructive" data-testid="bili-accounts-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {actionMessage ? (
        <p className="text-sm text-muted-foreground" data-testid="bili-accounts-message">
          {actionMessage}
        </p>
      ) : null}

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent data-testid="bili-account-revoke-dialog">
          <DialogHeader>
            <DialogTitle>确认撤销账号？</DialogTitle>
            <DialogDescription>
              将删除加密凭据并把状态标为已撤销。采集器不能再使用该账号；此操作不可恢复采集能力。账号行会保留用于审计。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevokeTarget(null)}
              data-testid="bili-account-revoke-cancel"
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !revokeTarget}
              data-testid="bili-account-revoke-confirm"
              onClick={() => {
                if (!revokeTarget) return;
                setLocalError(null);
                revokeMutation.mutate(revokeTarget.id, {
                  onSuccess: (result) => {
                    setRevokeTarget(null);
                    setActionMessage(result.message);
                  },
                  onError: (err) => {
                    setLocalError(err instanceof Error ? err.message : '撤销失败');
                  },
                });
              }}
            >
              确认撤销
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
