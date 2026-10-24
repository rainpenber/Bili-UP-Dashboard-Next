import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DefaultFlowEditor } from '@/features/commercial/components/default-flow-editor';
import { LiveTemplatePanel } from '@/features/commercial/components/live-template-panel';
import { BiliAccountsPanel } from '@/features/settings/bili-accounts-panel';
import { StudioOwnerSettingsForm } from '@/features/settings/studio-owner-settings-form';

export function IntegrationsSettingsPage() {
  return (
    <>
      <PageHeader
        title="集成与设置"
        description="通知渠道与对接能力后续再接；这里可管理采集用 B 站账号、本人 UID 与新商单默认流程模板。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '集成与设置' }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,22rem)_1fr] xl:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">B 站账号</CardTitle>
              <p className="text-sm font-normal text-muted-foreground">
                采集登录账号与 Cookie 凭据。与下方「本人 B 站账号」（只看我的）相互独立。
              </p>
            </CardHeader>
            <CardContent>
              <BiliAccountsPanel />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">本人 B 站账号</CardTitle>
              <p className="text-sm font-normal text-muted-foreground">
                默认狐正正。供监控「只看我的」使用，不是登录账号。
              </p>
            </CardHeader>
            <CardContent>
              <StudioOwnerSettingsForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">通知与集成（规划中）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>微信、飞书、OneNote 等接入在本里程碑不做真实配置；上线后在这里统一管理。</p>
              <p>
                <Link
                  to="/ops"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  打开运维诊断
                </Link>
                ，查看采集心跳、运行记录和日志。
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据库默认模板</CardTitle>
              <p className="text-sm font-normal text-muted-foreground">
                已发布模板的节点和连线。改名只留在本页。
              </p>
            </CardHeader>
            <CardContent>
              <LiveTemplatePanel />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">新项目默认流程</CardTitle>
              <p className="text-sm font-normal text-muted-foreground">
                草稿和已发布版本仍在本页内存里。发布只作用于之后新建的演示项目。
              </p>
            </CardHeader>
            <CardContent>
              <DefaultFlowEditor />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
