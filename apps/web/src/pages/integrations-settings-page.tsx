import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DefaultFlowEditor } from '@/features/commercial/components/default-flow-editor';

export function IntegrationsSettingsPage() {
  return (
    <>
      <PageHeader
        title="集成与设置"
        description="通知以后再接。这里可以改新项目默认怎么走。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '集成与设置' }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,22rem)_1fr] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">通知和对接（还没做）</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            微信、飞书、OneNote 还不能在这里配置。
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">新项目默认流程</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              可以改草稿、发布，也可以回看已发布的版本；只影响以后新建的项目。
            </p>
          </CardHeader>
          <CardContent>
            <DefaultFlowEditor />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
