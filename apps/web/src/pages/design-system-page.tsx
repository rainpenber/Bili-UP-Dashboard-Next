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
        description="集中看颜色、按钮和提示长什么样。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '设计系统' }]}
      />

      <div className="space-y-10">
        <Section title="颜色" description="页面和图表用的颜色。">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ['背景', 'bg-background border'],
              ['文字', 'bg-foreground'],
              ['主色', 'bg-primary'],
              ['弱化', 'bg-muted'],
              ['危险', 'bg-destructive'],
              ['成功', 'bg-success'],
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
            <Button variant="outline">线框</Button>
            <Button variant="ghost">文字</Button>
            <Button variant="destructive">危险</Button>
            <Button disabled>不可用</Button>
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
            <AlertDescription>这是一条普通提示。</AlertDescription>
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

        <Section title="加载、空和出错">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">正在加载</CardTitle>
                <CardDescription>列表还在加载时的样子</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
            <EmptyState title="没有内容" description="这里会告诉你下一步可以做什么。" />
            <ErrorState message="连不上服务。" onRetry={() => undefined} />
          </div>
        </Section>
      </div>
    </>
  );
}
