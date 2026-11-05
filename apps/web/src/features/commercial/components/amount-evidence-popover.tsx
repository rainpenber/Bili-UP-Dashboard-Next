import type { CommercialAmountEvidence } from '@studio/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRebateRate, formatYuan } from '../commercial-selectors';
import { formatScheduleLabel } from '../node-schedule';

function moneyLabel(value: string | null): string {
  if (value === null) return '未填写';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return formatYuan(amount);
}

function sortedEvidence(evidence: CommercialAmountEvidence[]): CommercialAmountEvidence[] {
  return [...evidence].sort((a, b) => a.at.localeCompare(b.at));
}

export function AmountEvidencePopover({
  platformAmount,
  agreedRebateRate,
  rationale,
  evidence,
  className,
}: {
  platformAmount: string | null;
  agreedRebateRate: string | null;
  rationale: string | null;
  evidence: CommercialAmountEvidence[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'up' | 'down'>('down');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(() => sortedEvidence(evidence), [evidence]);
  const visible = showAll ? ordered : ordered.slice(0, 5);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        aria-label="金额依据"
        aria-expanded={open}
        className="inline-flex size-5 items-center justify-center rounded-full border text-xs font-semibold text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="amount-evidence-trigger"
        ref={triggerRef}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            const below = window.innerHeight - rect.bottom;
            setPlacement(below < 360 && rect.top > below ? 'up' : 'down');
          }
          setOpen((value) => !value);
        }}
      >
        ?
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="关闭金额依据"
            className="fixed inset-0 z-40 bg-black/20 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="金额依据"
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 scroll-slim max-h-[70vh] overflow-y-auto overflow-x-hidden [overflow-wrap:anywhere] rounded-t-xl border bg-card p-4 text-left text-sm text-card-foreground shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:right-auto sm:max-h-[min(60vh,24rem)] sm:w-80 sm:max-w-[calc(100vw-2rem)] sm:rounded-lg',
              placement === 'up' ? 'sm:bottom-full sm:mb-2' : 'sm:top-full sm:mt-2',
            )}
            data-testid="amount-evidence-popover"
          >
            <dl className="space-y-1" data-testid="amount-platform-summary">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">平台下单价格</dt>
                <dd className="font-medium">{moneyLabel(platformAmount)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">商议返点比例</dt>
                <dd className="font-medium">{formatRebateRate(agreedRebateRate)}</dd>
              </div>
            </dl>
            <div className="mt-3 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">判定理由</p>
              <p className="mt-1" data-testid="amount-rationale">
                {rationale ?? '暂无判定理由'}
              </p>
            </div>
            <div className="mt-3 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">原文原话</p>
              {ordered.length === 0 ? (
                <p className="mt-2 text-muted-foreground" data-testid="amount-evidence-empty">
                  暂无原文依据，可让 Hermes 补录
                </p>
              ) : (
                <>
                  <ul className="mt-2 space-y-2">
                    {visible.map((item, index) => (
                      <li
                        key={`${item.at}-${index}`}
                        className="rounded-md bg-muted/40 px-2 py-1.5"
                        data-testid="amount-evidence-quote"
                      >
                        <p className="text-xs text-muted-foreground">
                          {item.speaker} · {formatScheduleLabel(item.at)}
                        </p>
                        <p className="mt-0.5">{item.text}</p>
                      </li>
                    ))}
                  </ul>
                  {ordered.length > 5 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 px-2"
                      onClick={() => setShowAll((value) => !value)}
                    >
                      {showAll ? '收起' : '查看全部'}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
