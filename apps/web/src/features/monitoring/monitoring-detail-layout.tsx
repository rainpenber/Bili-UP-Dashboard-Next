import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReactNode } from 'react';

type Props = {
  title: string;
  description?: string;
  entityLabel: string;
  backTo: string;
  meta: { label: string; value: ReactNode }[];
  charts: ReactNode;
  status?: ReactNode;
  /** Compact monitor bar directly under the title, above metadata. */
  toolbar?: ReactNode;
  /** Right column on wide screens, stacked under the metadata card on narrow screens. */
  aside?: ReactNode;
  /** Full-width block under the metadata / charts grid. */
  footer?: ReactNode;
  testId?: string;
};

export function MonitoringDetailLayout({
  title,
  description,
  entityLabel,
  backTo,
  meta,
  charts,
  status,
  toolbar,
  aside,
  footer,
  testId,
}: Props) {
  return (
    <div data-testid={testId} className="min-w-0 max-w-full overflow-x-hidden">
      <PageHeader
        title={title}
        {...(description ? { description } : {})}
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '监控', to: '/monitoring' },
          { label: entityLabel },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={backTo}>
              <ArrowLeft className="size-4" aria-hidden />
              返回列表
            </Link>
          </Button>
        }
      />
      {toolbar ? (
        <div data-testid="monitor-detail-toolbar" className="mb-6 min-w-0 max-w-full">
          {toolbar}
        </div>
      ) : null}
      <div
        data-testid="monitor-detail-grid"
        className="grid min-w-0 max-w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">元数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {status ? <div>{status}</div> : null}
            <dl className="space-y-2">
              {meta.map(({ label, value }) => (
                <div key={label} className="grid grid-cols-[6rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-all font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="flex min-w-0 flex-col gap-6" data-testid="monitor-detail-aside">
          {aside}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-base">指标趋势</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">{charts}</CardContent>
          </Card>
        </div>
      </div>
      {footer ? <div className="mt-6 min-w-0 max-w-full">{footer}</div> : null}
    </div>
  );
}
