import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { CommercialHomePage } from '@/pages/commercial-home-page';
import { DesignSystemPage } from '@/pages/design-system-page';
import { OpsPage } from '@/features/ops/ops-page';
import { BiliAccountsSettingsPage } from '@/pages/bili-accounts-settings-page';
import { IntegrationsSettingsPage } from '@/pages/integrations-settings-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ProjectDemoPage } from '@/pages/project-demo-page';
import { ProjectDetailPage } from '@/pages/project-detail-page';
import { ProjectListPage } from '@/pages/project-list-page';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';
import { MonitoringCreatorDetailPage } from '@/pages/monitoring-creator-detail-page';
import { MonitoringDynamicDetailPage } from '@/pages/monitoring-dynamic-detail-page';
import { MonitoringVideoDetailPage } from '@/pages/monitoring-video-detail-page';
import { AudienceReactionPage } from '@/pages/audience-reaction-page';
import { WorkflowMockPage } from '@/pages/workflow-mock-page';

export const appRouteConfig: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <CommercialHomePage /> },
      { path: 'projects', element: <ProjectListPage /> },
      { path: 'projects/demo/:projectId', element: <ProjectDemoPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'monitoring', element: <MonitoringPage /> },
      { path: 'monitoring/videos/:bvid', element: <MonitoringVideoDetailPage /> },
      { path: 'monitoring/creators/:mid', element: <MonitoringCreatorDetailPage /> },
      { path: 'monitoring/dynamics/:id', element: <MonitoringDynamicDetailPage /> },
      { path: 'content', element: <AudienceReactionPage /> },
      { path: 'integrations', element: <IntegrationsSettingsPage /> },
      { path: 'settings/accounts', element: <BiliAccountsSettingsPage /> },
      { path: 'ops', element: <OpsPage /> },
      { path: 'design-system', element: <DesignSystemPage /> },
      { path: 'workflow-mock', element: <WorkflowMockPage /> },
      { path: 'monitor', element: <Navigate to="/monitoring" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function childRoutePaths(): string[] {
  const root = appRouteConfig[0];
  return (root?.children ?? []).map((c) => c.path).filter(Boolean) as string[];
}
