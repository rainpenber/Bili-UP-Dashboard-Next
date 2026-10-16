import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="页面不存在" description="这个地址没有对应的页面。" />
      <div className="rounded-lg border bg-muted/20 px-6 py-10 text-center">
        <p className="mb-4 text-sm text-muted-foreground">找不到这个页面。</p>
        <Button asChild>
          <Link to="/monitoring">去监控</Link>
        </Button>
      </div>
    </>
  );
}
