import { createHealthResponse } from '@studio/contracts';
import { createSql, runMigrations } from '@studio/db';
import { Hono } from 'hono';
import { readMonitorDataSource } from './data-source';
import { createAssetsRoutes } from './assets-routes';
import { createImportRoutes } from './import-routes';
import { createMonitorRoutes } from './monitor-routes';
import { createCommercialRoutes } from './commercial-routes';
import { registerWebSpa, resolveWebStaticRoot } from './static-spa';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'studio-api';

export type CreateAppOptions = {
  skipDb?: boolean;
};

export function createApp(options: CreateAppOptions = {}) {
  readMonitorDataSource();

  const app = new Hono();

  app.get('/health', (c) => {
    const body = createHealthResponse({
      service: SERVICE_NAME,
      version: API_VERSION,
    });
    return c.json(body);
  });

  app.get('/api/health', (c) => {
    const body = createHealthResponse({
      service: SERVICE_NAME,
      version: API_VERSION,
    });
    return c.json(body);
  });

  if (!options.skipDb) {
    const sql = createSql();
    void runMigrations(sql).catch((err) => {
      console.error('Migration failed', err);
    });
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
    app.route('/api/v1/assets', createAssetsRoutes(sql));
    app.route('/api/v1/imports', createImportRoutes(sql));
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }

  const staticRoot = resolveWebStaticRoot();
  if (staticRoot) {
    registerWebSpa(app, staticRoot);
  }

  return app;
}
