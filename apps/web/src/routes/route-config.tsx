import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { primaryNav } from '@/config/navigation';
import { DesignSystemPage } from '@/pages/design-system-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PlaceholderPage } from '@/pages/placeholder-page';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';
import { MonitoringCreatorDetailPage } from '@/pages/monitoring-creator-detail-page';
import { MonitoringDynamicDetailPage } from '@/pages/monitoring-dynamic-detail-page';
import { MonitoringVideoDetailPage } from '@/pages/monitoring-video-detail-page';

function placeholderFor(path: string) {
  const nav = primaryNav.find((item) => item.to === path);
  if (!nav) throw new Error(`Missing nav config for ${path}`);
  return <PlaceholderPage nav={nav} />;
}

export const appRouteConfig: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: placeholderFor('/') },
      { path: 'projects', element: placeholderFor('/projects') },
      { path: 'monitoring', element: <MonitoringPage /> },
      { path: 'monitoring/videos/:bvid', element: <MonitoringVideoDetailPage /> },
      { path: 'monitoring/creators/:mid', element: <MonitoringCreatorDetailPage /> },
      { path: 'monitoring/dynamics/:id', element: <MonitoringDynamicDetailPage /> },
      { path: 'finance', element: placeholderFor('/finance') },
      { path: 'content', element: placeholderFor('/content') },
      { path: 'integrations', element: placeholderFor('/integrations') },
      { path: 'design-system', element: <DesignSystemPage /> },
      { path: 'monitor', element: <Navigate to="/monitoring" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function childRoutePaths(): string[] {
  const root = appRouteConfig[0];
  return (root?.children ?? []).map((c) => c.path).filter(Boolean) as string[];
}
