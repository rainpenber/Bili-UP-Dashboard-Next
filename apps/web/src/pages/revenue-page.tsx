import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CommercialRebate } from '@studio/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoneyText, formatYuanExact } from '@/features/commercial/commercial-selectors';
import { patchCommercialRebate } from '@/features/commercial/commercial-live-api';
import {
  commercialRebatesKey,
  useCommercialRebatesQuery,
  useRevenueMonthQuery,
} from '@/features/commercial/use-rebate-queries';

const CONTRACT_LABEL: Record<CommercialRebate['contractState'], string> = {
  none: '未发',
  sent: '已发',
  signed: '已签',
};

const INVOICE_LABEL: Record<CommercialRebate['invoiceState'], string> = {
  none: '未开',
  received: '已开',
};

function Money({ value }: { value: string }) {
  return <span className="font-mono tabular-nums">{value}</span>;
}

function ContractBadge({ rebate }: { rebate: CommercialRebate }) {
  if (rebate.contractState === 'signed') return <Badge variant="success">已签</Badge>;
  if (rebate.contractState === 'sent') return <Badge variant="info">已发</Badge>;
  return <Badge variant="outline">未发</Badge>;
}

function InvoiceBadge({ rebate }: { rebate: CommercialRebate }) {
  return rebate.invoiceState === 'received' ? (
    <Badge variant="success">已开</Badge>
  ) : (
    <Badge variant="outline">未开</Badge>
  );
}

export function RevenuePage() {
  const rebateQuery = useCommercialRebatesQuery();
  const now = useMemo(() => new Date(), []);
  const monthQuery = useRevenueMonthQuery(now);
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const items = rebateQuery.data?.items ?? [];
  const summary = rebateQuery.data?.summary ?? null;
  const outstanding = items.filter((item) => !item.isReturned);
  const settled = items.filter((item) => item.isReturned);

  const toggleReturned = (rebate: CommercialRebate) => {
    if (pendingId !== null) return;
    setPendingId(rebate.id);
    setToggleError(null);
    void patchCommercialRebate(rebate.id, {
      isReturned: true,
      expectedUpdatedAt: rebate.updatedAt,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: commercialRebatesKey }))
      .catch((err: unknown) => {
        setToggleError(
          err instanceof Error && err.message.trim().length > 0 ? err.message : '保存失败',
        );
      })
      .finally(() => setPendingId(null));
  };

  return (
    <>
      <PageHeader
        title="收入与返点"
        description="平台打款后按约定转给中介的返点台账。项目层 rebate_amount 是金额唯一权威。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '收入与返点' }]}
      />

      {rebateQuery.isPending ? (
        <LoadingListSkeleton rows={3} />
      ) : rebateQuery.isError ? (
        <ErrorState
          message={
            rebateQuery.error instanceof Error ? rebateQuery.error.message : '返点台账加载失败'
          }
          onRetry={() => void rebateQuery.refetch()}
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card data-testid="revenue-month">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">本月</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {monthQuery.isPending ? (
                  <p className="text-muted-foreground">统计中…</p>
                ) : monthQuery.isError ? (
                  <p className="text-muted-foreground">本月项目统计暂不可用</p>
                ) : (
                  <>
                    <p className="text-xl font-semibold tabular-nums">{monthQuery.data.count} 单</p>
                    <p>
                      平台下单{' '}
                      <Money value={formatYuanExact(Number(monthQuery.data.platformTotal))} />
                    </p>
                    <p>
                      应返 <Money value={formatYuanExact(Number(monthQuery.data.rebateTotal))} />
                    </p>
                    <p>
                      到手 <Money value={formatYuanExact(Number(monthQuery.data.netTotal))} />
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="revenue-outstanding">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">待返</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p
                  className="text-2xl font-semibold tabular-nums"
                  data-testid="revenue-outstanding-total"
                >
                  <Money value={formatMoneyText(summary?.outstandingTotal ?? '0.00')} />
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="revenue-outstanding-split"
                >
                  其中平台款已到 {formatMoneyText(summary?.outstandingPlatformPaid ?? '0.00')} ·
                  平台款未到 {formatMoneyText(summary?.outstandingPlatformUnpaid ?? '0.00')}
                </p>
                <p className="text-xs text-muted-foreground">未结清 {summary?.openCount ?? 0} 笔</p>
              </CardContent>
            </Card>

            <Card data-testid="revenue-settled">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  今年已结清
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p
                  className="text-2xl font-semibold tabular-nums"
                  data-testid="revenue-settled-total"
                >
                  <Money value={formatMoneyText(summary?.settledThisYear ?? '0.00')} />
                </p>
                <p className="text-xs text-muted-foreground">共 {settled.length} 笔已返</p>
              </CardContent>
            </Card>
          </div>

          {toggleError ? (
            <p className="text-sm text-destructive" role="alert">
              {toggleError}
            </p>
          ) : null}

          <section className="space-y-3" data-testid="revenue-outstanding-section">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">未结清返点</h2>
              <span className="text-xs text-muted-foreground">合同 / 开票进度按人工勾选记录</span>
            </div>
            {outstanding.length === 0 ? (
              <EmptyState title="没有待返记录" description="当前所有返点都已结清。" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">项目</th>
                      <th className="px-3 py-2 font-medium">对手方</th>
                      <th className="px-3 py-2 text-right font-medium">应返</th>
                      <th className="px-3 py-2 font-medium">合同</th>
                      <th className="px-3 py-2 font-medium">开票</th>
                      <th className="px-3 py-2 text-right font-medium">停留</th>
                      <th className="px-3 py-2 font-medium">备注</th>
                      <th className="px-3 py-2 font-medium">已返</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.map((rebate) => (
                      <tr
                        key={rebate.id}
                        className="border-t align-top"
                        data-testid="revenue-outstanding-row"
                      >
                        <td className="px-3 py-2 font-medium">
                          {rebate.projectName}
                          {rebate.platformPaid ? (
                            <Badge variant="warning" className="ml-2">
                              平台款已到
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {rebate.counterparty ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Money value={formatMoneyText(rebate.expectedAmount)} />
                        </td>
                        <td className="px-3 py-2">
                          <ContractBadge rebate={rebate} />
                        </td>
                        <td className="px-3 py-2">
                          <InvoiceBadge rebate={rebate} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {rebate.daysInStage} 天
                        </td>
                        <td className="max-w-[20rem] px-3 py-2 text-xs text-muted-foreground">
                          {rebate.note ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`标记 ${rebate.projectName} 已返`}
                            checked={false}
                            disabled={pendingId !== null}
                            onChange={() => toggleReturned(rebate)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <details className="rounded-lg border bg-card" data-testid="revenue-settled-fold">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              已结清 · {settled.length}
            </summary>
            <div className="overflow-x-auto border-t">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">项目</th>
                    <th className="px-3 py-2 font-medium">对手方</th>
                    <th className="px-3 py-2 text-right font-medium">应返</th>
                    <th className="px-3 py-2 font-medium">合同</th>
                    <th className="px-3 py-2 font-medium">开票</th>
                    <th className="px-3 py-2 font-medium">返款日</th>
                    <th className="px-3 py-2 font-medium">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((rebate) => (
                    <tr
                      key={rebate.id}
                      className="border-t align-top"
                      data-testid="revenue-settled-row"
                    >
                      <td className="px-3 py-2 font-medium">{rebate.projectName}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {rebate.counterparty ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={formatMoneyText(rebate.expectedAmount)} />
                      </td>
                      <td className="px-3 py-2">{CONTRACT_LABEL[rebate.contractState]}</td>
                      <td className="px-3 py-2">{INVOICE_LABEL[rebate.invoiceState]}</td>
                      <td className="px-3 py-2 tabular-nums">{rebate.returnedAt ?? '—'}</td>
                      <td className="max-w-[24rem] px-3 py-2 text-xs text-muted-foreground">
                        {rebate.note ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </>
  );
}
