import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/states/async-states';
import type { NavItem } from '@/config/navigation';

export function PlaceholderPage({ nav }: { nav: NavItem }) {
  return (
    <>
      <PageHeader
        title={nav.label}
        description={nav.description}
        crumbs={[{ label: '工作室', to: '/' }, { label: nav.label }]}
      />
      <EmptyState title="这里还没做好" description="先用看板、项目和监控。" />
    </>
  );
}
