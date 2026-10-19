import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { Sql } from '@studio/db';
import { createAssetsRoutes } from './assets-routes';
import { createCommercialRoutes } from './commercial-routes';
import { createImportRoutes } from './import-routes';
import { createMonitorRoutes } from './monitor-routes';

type InventoryRoute = {
  method: string;
  path: string;
  wired: boolean;
  frontendCallers: { file: string; evidence: string }[];
};

type Inventory = {
  apiRouteCount: number;
  wiredRouteCount: number;
  unwiredImplementedRouteCount: number;
  routes: InventoryRoute[];
};

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function registeredKeys(): string[] {
  const sql = (() => {
    throw new Error('inventory registration must not query');
  }) as unknown as Sql;
  const app = new Hono();
  app.get('/health', (c) => c.text('ok'));
  app.get('/api/health', (c) => c.text('ok'));
  app.route('/api/v1/monitor', createMonitorRoutes(sql));
  app.route('/api/v1/assets', createAssetsRoutes(sql));
  app.route('/api/v1/imports', createImportRoutes(sql));
  app.route('/api/v1/commercial', createCommercialRoutes(sql));
  const keys = app.routes
    .filter((route) => METHODS.has(route.method))
    .map((route) => `${route.method} ${route.path}`);
  return [...new Set(keys)].sort();
}

describe('api inventory', () => {
  test('matches registered routes and caller wiring', () => {
    const inventory = JSON.parse(
      readFileSync(
        new URL('../../../docs/architecture/api-inventory.json', import.meta.url),
        'utf8',
      ),
    ) as Inventory;
    const registered = registeredKeys();
    const listed = inventory.routes.map((route) => `${route.method} ${route.path}`).sort();
    expect(listed).toEqual(registered);
    expect(inventory.apiRouteCount).toBe(registered.length);
    expect(inventory.routes).toHaveLength(registered.length);
    const wired = inventory.routes.filter((route) => route.wired);
    const unwired = inventory.routes.filter((route) => !route.wired);
    expect(inventory.wiredRouteCount).toBe(wired.length);
    expect(inventory.unwiredImplementedRouteCount).toBe(unwired.length);
    expect(wired.length + unwired.length).toBe(registered.length);
    for (const route of inventory.routes) {
      expect(route.wired).toBe(route.frontendCallers.length > 0);
      for (const caller of route.frontendCallers) {
        const source = readFileSync(new URL(`../../../${caller.file}`, import.meta.url), 'utf8');
        expect(source).toContain(caller.evidence);
      }
    }
  });
});
