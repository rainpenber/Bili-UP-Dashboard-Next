import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { listRegisteredApiRoutes, routeKey } from './route-catalog';

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

function registeredKeys(): string[] {
  return listRegisteredApiRoutes().map(routeKey);
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
