import {
  Activity,
  Blocks,
  LayoutDashboard,
  Palette,
  Plug,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  implemented: boolean;
};

export const primaryNav: NavItem[] = [
  {
    to: '/',
    label: '今日看板',
    description: '今天要处理的事、等甲方的事，以及项目卡点汇总',
    icon: LayoutDashboard,
    implemented: true,
  },
  {
    to: '/projects',
    label: '项目',
    description: '商单列表与每个项目的流程详情',
    icon: Blocks,
    implemented: true,
  },
  {
    to: '/monitoring',
    label: '监控',
    description: 'B 站账号与内容指标',
    icon: Activity,
    implemented: true,
  },
  {
    to: '/content',
    label: '内容与工具',
    description: '素材与辅助工具（后续里程碑）',
    icon: Wrench,
    implemented: false,
  },
  {
    to: '/integrations',
    label: '集成与设置',
    description: '默认商单流程与后续通知对接',
    icon: Plug,
    implemented: true,
  },
  {
    to: '/design-system',
    label: '设计系统',
    description: '组件与令牌画廊',
    icon: Palette,
    implemented: true,
  },
];

export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/') return primaryNav[0];
  return primaryNav.find((item) => item.to !== '/' && pathname.startsWith(item.to));
}
