import { isUuidString } from '@studio/contracts';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { LiveProjectWorkflow } from '@/features/commercial/components/live-project-workflow';

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (projectId && isUuidString(projectId)) {
    return <LiveProjectWorkflow projectId={projectId} />;
  }
  return <LegacyDemoBookmark projectId={projectId} />;
}

function LegacyDemoBookmark({ projectId }: { projectId: string | undefined }) {
  return (
    <>
      <PageHeader
        title="这不是数据库项目"
        description="地址里的编号属于演示书签。这里不会按名称改去别的商单，也不会打开数据库时间轴。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
          { label: '演示书签' },
        ]}
      />
      <div className="space-y-4" data-testid="demo-bookmark">
        <p className="text-sm text-muted-foreground">
          {projectId ? `编号 ${projectId} 不是已保存商单的 ID。` : '缺少项目编号。'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/projects">返回项目列表</Link>
          </Button>
          {projectId ? (
            <Button variant="secondary" asChild>
              <Link to={`/projects/demo/${projectId}`}>打开这个编号的演示页</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
