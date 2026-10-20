import { createHealthResponse } from '@studio/contracts';
import { createSql, runMigrations } from '@studio/db';
import { createLogger, type StudioLogger } from '@studio/observability';
import { Hono } from 'hono';
import { matchedRoutes } from 'hono/route';
import { readMonitorDataSource } from './data-source';
import { mountApiRoutes } from './mount-api';
import { registerWebSpa, resolveWebStaticRoot } from './static-spa';

export const API_VERSION = '0.1.0';
export const SERVICE_NAME = 'studio-api';

export type ApiEnv = { Variables: { requestId: string; log: StudioLogger } };

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type ApiRequestObservation = {
  method: string;
  path: string;
  status: number;
};

export type CreateAppOptions = {
  skipDb?: boolean;
  logger?: StudioLogger;
  /** Test hook. Production does not set it. Records the matched handler, not middleware. */
  onRequest?: (observation: ApiRequestObservation) => void;
};

const API_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function observedRoute(c: { req: { method: string } }): { method: string; path: string } | null {
  const routes = matchedRoutes(c as Parameters<typeof matchedRoutes>[0]);
  for (let index = routes.length - 1; index >= 0; index -= 1) {
    const route = routes[index];
    if (!route || !API_METHODS.has(route.method)) continue;
    return { method: route.method, path: route.path };
  }
  return null;
}

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

  const app = new Hono<ApiEnv>();

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
      const matched = observedRoute(c);
      options.onRequest?.({
        method: matched?.method ?? method,
        path: matched?.path ?? path,
        status: 500,
      });
      log.error('http error', {
        event: 'http.error',
        err: error,
        context: { method, path, durationMs: Date.now() - started },
      });
      throw error;
    }
    const matched = observedRoute(c);
    if (matched) {
      options.onRequest?.({
        method: matched.method,
        path: matched.path,
        status: c.res.status,
      });
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
    mountApiRoutes(app, sql, { logger });
  }

  const staticRoot = resolveWebStaticRoot();
  if (staticRoot) {
    registerWebSpa(app as unknown as Hono, staticRoot);
  }

  return app;
}
