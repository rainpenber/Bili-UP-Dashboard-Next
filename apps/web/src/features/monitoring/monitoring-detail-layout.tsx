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
  chartsTitle?: string;
  status?: ReactNode;
};

export function MonitoringDetailLayout({
  title,
  description,
  entityLabel,
  backTo,
  meta,
  charts,
  chartsTitle = '变化趋势',
  status,
}: Props) {
  return (
    <>
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{chartsTitle}</CardTitle>
          </CardHeader>
          <CardContent>{charts}</CardContent>
        </Card>
      </div>
    </>
  );
}
