import { useState } from 'react';
import type { CommercialRebate, CommercialRebateUpdateRequest } from '@studio/contracts';
import { formatMoneyText } from '../commercial-selectors';

export type RebateChipPatch = Partial<Omit<CommercialRebateUpdateRequest, 'expectedUpdatedAt'>>;

const CONTRACT_LABEL: Record<CommercialRebate['contractState'], string> = {
  none: '未发',
  sent: '合同已发',
  signed: '合同已签',
};

const INVOICE_LABEL: Record<CommercialRebate['invoiceState'], string> = {
  none: '未开票',
  received: '已开票',
};

export function rebateChipText(rebate: CommercialRebate): string {
  return [
    `返点 ${formatMoneyText(rebate.expectedAmount)}`,
    CONTRACT_LABEL[rebate.contractState],
    INVOICE_LABEL[rebate.invoiceState],
    rebate.isReturned ? '已返' : '待转款',
  ].join(' · ');
}

export function RebateChip({
  rebate,
  onPatch,
}: {
  rebate: CommercialRebate;
  onPatch: (patch: RebateChipPatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (patch: RebateChipPatch) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    void onPatch(patch)
      .catch((err: unknown) => {
        setError(err instanceof Error && err.message.trim().length > 0 ? err.message : '保存失败');
      })
      .finally(() => setSaving(false));
  };

  const text = rebateChipText(rebate);

  if (rebate.isReturned) {
    return (
      <span
        className="inline-flex items-center rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs font-medium text-success tabular-nums"
        data-testid="rebate-chip"
      >
        {text}
      </span>
    );
  }

  return (
    <div className="space-y-2" data-testid="rebate-chip-block">
      <button
        type="button"
        className="inline-flex items-center rounded-md border bg-muted/40 px-2 py-1 text-xs font-medium text-foreground tabular-nums hover:bg-muted"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid="rebate-chip"
      >
        {text}
      </button>
      {open ? (
        <div
          className="space-y-2 rounded-md border bg-background p-2 text-xs"
          data-testid="rebate-chip-panel"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rebate.contractState === 'signed'}
              disabled={saving}
              onChange={(event) =>
                apply({ contractState: event.target.checked ? 'signed' : 'none' })
              }
            />
            合同已回寄
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rebate.invoiceState === 'received'}
              disabled={saving}
              onChange={(event) =>
                apply({ invoiceState: event.target.checked ? 'received' : 'none' })
              }
            />
            发票已收到
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={false}
              disabled={saving}
              onChange={(event) => {
                if (event.target.checked) apply({ isReturned: true });
              }}
            />
            已返
          </label>
          {error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
