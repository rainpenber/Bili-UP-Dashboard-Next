import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { putProjectAmount } from '../commercial-live-api';

function amountInput(value: string | null): string {
  return value ?? '';
}

function nullableAmount(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function AmountEditDialog({
  projectId,
  netAmount,
  rebateAmount,
  rationale,
  updatedAt,
  onSaved,
}: {
  projectId: string;
  netAmount: string | null;
  rebateAmount: string | null;
  rationale: string | null;
  updatedAt: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [net, setNet] = useState(amountInput(netAmount));
  const [rebate, setRebate] = useState(amountInput(rebateAmount));
  const [reason, setReason] = useState(rationale ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setError(null);
    if (next) {
      setNet(amountInput(netAmount));
      setRebate(amountInput(rebateAmount));
      setReason(rationale ?? '');
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    void putProjectAmount(projectId, {
      netAmount: nullableAmount(net),
      rebateAmount: nullableAmount(rebate),
      rationale: reason.trim().length > 0 ? reason : null,
      evidence: [],
      expectedUpdatedAt: updatedAt,
    })
      .then(() => {
        setOpen(false);
        onSaved();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        setError(message.trim().length > 0 ? message : '金额保存失败，请稍后重试');
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="amount-edit-trigger">
          编辑金额
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="amount-edit-dialog">
        <DialogHeader>
          <DialogTitle>编辑金额</DialogTitle>
          <DialogDescription>原文依据只读，由 Hermes 写入。</DialogDescription>
        </DialogHeader>
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="amount-net">净额</Label>
            <Input
              id="amount-net"
              inputMode="decimal"
              value={net}
              onChange={(event) => setNet(event.target.value)}
              placeholder="20000.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount-rebate">返点</Label>
            <Input
              id="amount-rebate"
              inputMode="decimal"
              value={rebate}
              onChange={(event) => setRebate(event.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount-rationale">判定理由</Label>
            <textarea
              id="amount-rationale"
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存金额'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
