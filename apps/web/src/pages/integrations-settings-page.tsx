import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DefaultFlowEditor } from '@/features/commercial/components/default-flow-editor';

export function IntegrationsSettingsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="集成与设置"
        description="通知渠道与对接能力后续再接；这里可编辑新商单的默认流程模板。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '集成与设置' }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,22rem)_1fr] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">通知与集成（规划中）</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            微信、飞书、OneNote 等接入在本里程碑不做真实配置；上线后在这里统一管理。
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">新项目默认流程</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              编辑草稿、发布版本；已发布版本可回看。发布只作用于之后新建的项目。
            </p>
          </CardHeader>
          <CardContent>
            <DefaultFlowEditor
              onProjectCreated={(project) => {
                navigate(`/projects/${project.id}/graph`);
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
