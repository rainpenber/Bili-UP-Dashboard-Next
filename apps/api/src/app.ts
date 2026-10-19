import { createHealthResponse } from '@studio/contracts';
import { createSql, runMigrations } from '@studio/db';
import { createLogger, type StudioLogger } from '@studio/observability';
import { Hono } from 'hono';
import { readMonitorDataSource } from './data-source';
import { createAssetsRoutes } from './assets-routes';
import { createCommercialRoutes } from './commercial-routes';
import { createImportRoutes } from './import-routes';
import { createMonitorRoutes } from './monitor-routes';
import { createOpsRoutes } from './ops-routes';
import { registerWebSpa, resolveWebStaticRoot } from './static-spa';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'studio-api';

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type CreateAppOptions = {
  skipDb?: boolean;
  logger?: StudioLogger;
};

function requestIdFrom(header: string | undefined): string {
  const value = header?.trim() ?? '';
  return REQUEST_ID.test(value) ? value : crypto.randomUUID();
}

export function createApp(options: CreateAppOptions = {}) {
  readMonitorDataSource();
  const logger =
    options.logger ??
    createLogger({
      service: 'api',
      instance: process.env.HOSTNAME ?? 'api',
    });

  const app = new Hono<{ Variables: { requestId: string; log: StudioLogger } }>();

  app.use('*', async (c, next) => {
    const requestId = requestIdFrom(c.req.header('x-request-id'));
    const started = Date.now();
    const log = logger.child({ requestId });
    c.set('requestId', requestId);
    c.set('log', log);
    c.header('x-request-id', requestId);
    const path = c.req.path;
    const method = c.req.method;
    try {
      await next();
    } catch (error) {
      log.error('http error', {
        event: 'http.error',
        err: error,
        context: { method, path, durationMs: Date.now() - started },
      });
      throw error;
    }
    const durationMs = Date.now() - started;
    if (c.error) {
      log.error('http error', {
        event: 'http.error',
        err: c.error,
        context: { method, path, status: c.res.status, durationMs },
      });
      return;
    }
    log.info('http request', {
      event: 'http.request',
      context: { method, path, status: c.res.status, durationMs },
    });
  });

  app.onError((_err, c) => {
    const requestId = c.get('requestId');
    if (requestId) c.header('x-request-id', requestId);
    return c.json({ error: 'internal' }, 500);
  });

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
    app.route('/api/v1/ops', createOpsRoutes(sql));
  }

  const staticRoot = resolveWebStaticRoot();
  if (staticRoot) {
    registerWebSpa(app as unknown as Hono, staticRoot);
  }

  return app;
}
