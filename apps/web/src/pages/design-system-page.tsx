import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState } from '@/components/states/async-states';

export function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="设计系统"
        description="M2.5 组件与语义令牌的可视化回归面；变更 UI 时请先对照此页。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '设计系统' }]}
      />

      <div className="space-y-10">
        <Section title="颜色与语义令牌" description="CSS 变量驱动；图表系列色见 --chart-*。">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ['background', 'bg-background border'],
              ['foreground', 'bg-foreground'],
              ['primary', 'bg-primary'],
              ['muted', 'bg-muted'],
              ['destructive', 'bg-destructive'],
              ['success', 'bg-success'],
            ].map(([name, cls]) => (
              <div key={name} className="space-y-2">
                <div className={cls + ' h-12 rounded-md'} />
                <p className="text-xs text-muted-foreground">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="按钮与输入">
          <div className="flex flex-wrap gap-2">
            <Button>主要操作</Button>
            <Button variant="secondary">次要</Button>
            <Button variant="outline">描边</Button>
            <Button variant="ghost">幽灵</Button>
            <Button variant="destructive">危险</Button>
            <Button disabled>禁用</Button>
          </div>
          <div className="mt-4 max-w-sm">
            <Input placeholder="输入示例" aria-invalid={false} />
          </div>
        </Section>

        <Section title="标签与提示">
          <div className="flex flex-wrap gap-2">
            <Badge>默认</Badge>
            <Badge variant="secondary">次要</Badge>
            <Badge variant="success">成功</Badge>
            <Badge variant="warning">警告</Badge>
            <Badge variant="destructive">错误</Badge>
            <Badge variant="info">信息</Badge>
          </div>
          <Alert variant="info" className="mt-4">
            <AlertTitle>信息提示</AlertTitle>
            <AlertDescription>Operate 模式：强调可扫描性与一致交互状态。</AlertDescription>
          </Alert>
        </Section>

        <Section title="选项卡与分页">
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">选项 A</TabsTrigger>
              <TabsTrigger value="b">选项 B</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="text-sm text-muted-foreground">
              内容 A
            </TabsContent>
            <TabsContent value="b" className="text-sm text-muted-foreground">
              内容 B
            </TabsContent>
          </Tabs>
          <Pagination page={2} totalPages={5} onPageChange={() => undefined} className="mt-4" />
        </Section>

        <Section title="异步状态">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">骨架屏</CardTitle>
                <CardDescription>列表加载占位</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
            <EmptyState title="空状态" description="说明下一步可以做什么。" />
            <ErrorState message="示例错误：无法连接服务。" onRetry={() => undefined} />
          </div>
        </Section>
      </div>
    </>
  );
}
