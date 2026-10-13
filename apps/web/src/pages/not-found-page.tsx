import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="页面不存在" description="您访问的路径尚未配置或已被移动。" />
      <div className="rounded-lg border bg-muted/20 px-6 py-10 text-center">
        <p className="mb-4 text-sm text-muted-foreground">错误代码：404</p>
        <Button asChild>
          <Link to="/monitoring">返回监控中心</Link>
        </Button>
      </div>
    </>
  );
}
