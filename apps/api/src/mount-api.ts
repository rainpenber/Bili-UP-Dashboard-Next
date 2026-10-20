import type { Sql } from '@studio/db';
import type { Hono } from 'hono';
import type { ApiEnv } from './app';
import { createAssetsRoutes } from './assets-routes';
import { createCommercialRoutes } from './commercial-routes';
import { createImportRoutes } from './import-routes';
import { createMonitorRoutes, type MonitorRefreshOptions } from './monitor-routes';
import { createOpsRoutes } from './ops-routes';

/** Same prefix list as the process entry. Call once per process. */
export function mountApiRoutes(
  app: Hono<ApiEnv>,
  db: Sql,
  monitor: MonitorRefreshOptions = {},
): void {
  app.route('/api/v1/monitor', createMonitorRoutes(db, monitor));
  app.route('/api/v1/assets', createAssetsRoutes(db));
  app.route('/api/v1/imports', createImportRoutes(db));
  app.route('/api/v1/commercial', createCommercialRoutes(db));
  app.route('/api/v1/ops', createOpsRoutes(db));
}
