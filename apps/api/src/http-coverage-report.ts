export type CoverageHit = {
  method: string;
  path: string;
  status: number;
  test: string;
};

export type TestOutcome = 'passed' | 'failed';

export type CoverageCase = {
  test: string;
  status: number;
  http: 'success' | 'reject';
  assertions: TestOutcome;
};

export type CoverageRouteReport = {
  method: string;
  path: string;
  readWrite: string | null;
  frontendCaller: boolean;
  executed: boolean;
  httpSuccess: boolean;
  accepted: boolean;
  cases: CoverageCase[];
};

export type HttpCoverageReport = {
  databaseName: string | null;
  retainedDatabase: boolean;
  registeredCount: number;
  inventoryCount: number;
  executedCount: number;
  httpSuccessCount: number;
  acceptedCount: number;
  acceptancePassed: boolean;
  upstreamFetchCount: number;
  injectedTransportCalls: number;
  routes: CoverageRouteReport[];
};

export function routeKey(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

function httpClass(status: number): 'success' | 'reject' {
  return status < 400 ? 'success' : 'reject';
}

export function buildHttpCoverageReport(input: {
  registered: { method: string; path: string }[];
  inventory: {
    method: string;
    path: string;
    readWrite?: string;
    frontendCallers: unknown[];
  }[];
  hits: CoverageHit[];
  testOutcomes: ReadonlyMap<string, TestOutcome>;
  databaseName: string | null;
  upstreamFetchCount: number;
  injectedTransportCalls: number;
}): HttpCoverageReport {
  const inventoryByKey = new Map(input.inventory.map((route) => [routeKey(route), route]));
  const routes = input.registered.map((route) => {
    const key = routeKey(route);
    const seen = input.hits.filter((hit) => routeKey(hit) === key);
    const meta = inventoryByKey.get(key);
    const cases: CoverageCase[] = seen.map((hit) => ({
      test: hit.test,
      status: hit.status,
      http: httpClass(hit.status),
      assertions: input.testOutcomes.get(hit.test) === 'passed' ? 'passed' : 'failed',
    }));
    const httpSuccess = cases.some((item) => item.http === 'success');
    const accepted = cases.some((item) => item.http === 'success' && item.assertions === 'passed');
    return {
      method: route.method,
      path: route.path,
      readWrite: meta?.readWrite ?? null,
      frontendCaller: (meta?.frontendCallers.length ?? 0) > 0,
      executed: seen.length > 0,
      httpSuccess,
      accepted,
      cases,
    };
  });
  const acceptedCount = routes.filter((route) => route.accepted).length;
  return {
    databaseName: input.databaseName,
    retainedDatabase: true,
    registeredCount: input.registered.length,
    inventoryCount: input.inventory.length,
    executedCount: routes.filter((route) => route.executed).length,
    httpSuccessCount: routes.filter((route) => route.httpSuccess).length,
    acceptedCount,
    acceptancePassed: input.registered.length > 0 && acceptedCount === input.registered.length,
    upstreamFetchCount: input.upstreamFetchCount,
    injectedTransportCalls: input.injectedTransportCalls,
    routes,
  };
}

export function renderHttpCoverageMarkdown(report: HttpCoverageReport): string {
  const verdict = report.acceptancePassed
    ? '验收结论：通过。每一条注册路由都有一次 HTTP 成功响应，且发出该响应的测试断言已通过。'
    : '验收结论：未通过。HTTP 成功响应不能代替断言；断言失败的路由不算验收通过。';
  const lines = [
    '# HTTP API 覆盖',
    '',
    report.databaseName
      ? `验收库 \`${report.databaseName}\` 保留，本文件不执行 DROP DATABASE。`
      : '本报告没有验收库名称。',
    '',
    `注册 ${report.registeredCount}，清单 ${report.inventoryCount}，已执行 ${report.executedCount}，HTTP 成功 ${report.httpSuccessCount}，断言验收 ${report.acceptedCount}。`,
    '',
    verdict,
    '',
    `注入 transport 调用 ${report.injectedTransportCalls} 次，逃逸到上游的 fetch ${report.upstreamFetchCount} 次。`,
    '',
    ...report.routes.flatMap((route) => {
      const cases =
        route.cases.length === 0
          ? ['- 没有请求记录']
          : route.cases.map(
              (item) =>
                `- ${item.test}：HTTP ${item.status}（${item.http === 'success' ? '成功响应' : '拒绝响应'}，断言${item.assertions === 'passed' ? '通过' : '未通过'}）`,
            );
      return [
        `## ${route.method} \`${route.path}\``,
        '',
        `- 前端调用：${route.frontendCaller ? '有' : '无'}`,
        `- 已执行：${route.executed ? '是' : '否'}`,
        `- HTTP 成功：${route.httpSuccess ? '是' : '否'}`,
        `- 断言验收：${route.accepted ? '是' : '否'}`,
        ...cases,
        '',
      ];
    }),
  ];
  return `${lines.join('\n')}\n`;
}
