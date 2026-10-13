import {
  Activity,
  Blocks,
  CircleDollarSign,
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
    description: '逾期、阻塞与待办优先事项',
    icon: LayoutDashboard,
    implemented: true,
  },
  {
    to: '/projects',
    label: '项目',
    description: '商单看板、列表与详情',
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
    to: '/finance',
    label: '财务结案',
    description: '对账与结案（后续里程碑）',
    icon: CircleDollarSign,
    implemented: false,
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
    description: '通知渠道与系统设置（后续里程碑）',
    icon: Plug,
    implemented: false,
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
