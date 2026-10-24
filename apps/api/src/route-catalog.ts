import type { Sql } from '@studio/db';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export type RegisteredRoute = {
  method: string;
  path: string;
};

export function routeKey(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

/**
 * Routes mounted the same way as apps/api/src/index.ts:
 * createApp({ skipDb: true }) then mountApiRoutes once.
 * SPA and static handlers are absent unless a built web root exists.
 */
export function listRegisteredApiRoutes(): RegisteredRoute[] {
  const sql = (() => {
    throw new Error('route catalog must not query');
  }) as unknown as Sql;
  const previousStatic = process.env.WEB_STATIC_ROOT;
  delete process.env.WEB_STATIC_ROOT;
  let app: ReturnType<typeof createApp>;
  try {
    app = createApp({ skipDb: true });
  } finally {
    if (previousStatic === undefined) delete process.env.WEB_STATIC_ROOT;
    else process.env.WEB_STATIC_ROOT = previousStatic;
  }
  mountApiRoutes(app, sql);
  const seen = new Set<string>();
  const routes: RegisteredRoute[] = [];
  for (const route of app.routes) {
    if (!METHODS.has(route.method)) continue;
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: route.method, path: route.path });
  }
  routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
  return routes;
}
