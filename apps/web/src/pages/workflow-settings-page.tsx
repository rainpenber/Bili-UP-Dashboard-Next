import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function WorkflowSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="工作流模板"
        description="修改默认模板并发布新版本，仅影响此后新建的项目。"
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">默认商单流程</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          模板可视化编辑与版本发布 API
          已就绪；本页将在下一迭代接入完整编辑器。已创建项目保持创建时的模板版本不变。
        </CardContent>
      </Card>
    </div>
  );
}
