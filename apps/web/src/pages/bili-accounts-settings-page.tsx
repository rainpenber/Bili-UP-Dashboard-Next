import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BiliAccountsPanel } from '@/features/settings/bili-accounts-panel';

/** Dedicated settings surface for WP-R2-25A (`/settings/accounts`). */
export function BiliAccountsSettingsPage() {
  return (
    <>
      <PageHeader
        title="B 站账号"
        description="管理采集用登录账号、凭据过期状态与撤销。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '集成与设置', to: '/integrations' },
          { label: 'B 站账号' },
        ]}
      />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">采集账号</CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            Cookie 仅存加密副本；撤销后不可再被采集选中。
          </p>
        </CardHeader>
        <CardContent>
          <BiliAccountsPanel />
        </CardContent>
      </Card>
    </>
  );
}
