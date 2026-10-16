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
    description: '今天要办的事、等甲方的事，以及卡住的项目',
    icon: LayoutDashboard,
    implemented: true,
  },
  {
    to: '/projects',
    label: '项目',
    description: '商单列表，以及每个项目做到哪一步',
    icon: Blocks,
    implemented: true,
  },
  {
    to: '/monitoring',
    label: '监控',
    description: 'B 站账号和内容数据',
    icon: Activity,
    implemented: true,
  },
  {
    to: '/content',
    label: '内容与工具',
    description: '素材和辅助工具，以后再做',
    icon: Wrench,
    implemented: false,
  },
  {
    to: '/integrations',
    label: '集成与设置',
    description: '通知，以及新项目默认怎么走',
    icon: Plug,
    implemented: true,
  },
  {
    to: '/design-system',
    label: '设计系统',
    description: '颜色、按钮和提示长什么样',
    icon: Palette,
    implemented: true,
  },
];

export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/') return primaryNav[0];
  return primaryNav.find((item) => item.to !== '/' && pathname.startsWith(item.to));
}
