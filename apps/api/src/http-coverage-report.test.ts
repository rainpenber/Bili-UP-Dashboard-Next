import { describe, expect, test } from 'bun:test';
import { buildHttpCoverageReport, type CoverageHit } from './http-coverage-report';
import { listRegisteredApiRoutes } from './route-catalog';

describe('http coverage report', () => {
  test('a failed write assertion does not turn 2xx responses into acceptance', () => {
    const registered = listRegisteredApiRoutes();
    const hits: CoverageHit[] = registered.map((route) => ({
      method: route.method,
      path: route.path,
      status: 200,
      test: 'imports',
    }));
    const failed = buildHttpCoverageReport({
      registered,
      inventory: registered.map((route) => ({ ...route, frontendCallers: [] })),
      hits,
      testOutcomes: new Map([['imports', 'failed']]),
      databaseName: null,
      upstreamFetchCount: 0,
      injectedTransportCalls: 0,
    });
    expect(failed.registeredCount).toBe(registered.length);
    expect(failed.executedCount).toBe(registered.length);
    expect(failed.httpSuccessCount).toBe(registered.length);
    expect(failed.acceptedCount).toBe(0);
    expect(failed.acceptancePassed).toBe(false);
    expect(failed.routes.every((route) => route.httpSuccess && !route.accepted)).toBe(true);
    expect(failed.routes[0]?.cases[0]).toMatchObject({
      test: 'imports',
      status: 200,
      http: 'success',
      assertions: 'failed',
    });

    const passed = buildHttpCoverageReport({
      registered,
      inventory: registered.map((route) => ({ ...route, frontendCallers: [] })),
      hits,
      testOutcomes: new Map([['imports', 'passed']]),
      databaseName: null,
      upstreamFetchCount: 0,
      injectedTransportCalls: 0,
    });
    expect(passed.acceptedCount).toBe(registered.length);
    expect(passed.acceptancePassed).toBe(true);
  });
});
