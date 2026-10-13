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
      <EmptyState
        title="该模块尚未在 M2.5 交付"
        description="当前里程碑仅实现应用壳、设计系统与监控页面。此处不会展示虚构业务数据；后续里程碑将接入真实流程与指标。"
      />
    </>
  );
}
