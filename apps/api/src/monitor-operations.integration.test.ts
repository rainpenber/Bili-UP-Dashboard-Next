import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createLogger } from '@studio/observability';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { parseOpsOperationList } from '@studio/contracts';
import { createApp } from './app';
import { createMonitorRoutes } from './monitor-routes';
import { createOpsRoutes } from './ops-routes';

const RANGE = 'since=2020-01-01&until=2099-01-01';

describe('monitor operation events through the product API', () => {
  let sql: Sql | null = null;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_14_act');
    sql = isolated.sql;
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  function buildApp(withLogger: boolean) {
    if (!sql) throw new Error('sql missing');
    const logger = createLogger({
      service: 'api',
      sql,
      instance: 'wp-r2-14-act',
      destination: () => undefined,
    });
    const app = withLogger ? createApp({ skipDb: true, logger }) : createApp({ skipDb: true });
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
    app.route('/api/v1/ops', createOpsRoutes(sql));
    return app;
  }

  async function eventsFor(requestId: string): Promise<{ event: string; context: unknown }[]> {
    if (!sql) throw new Error('sql missing');
    return sql<{ event: string; context: unknown }[]>`
      SELECT event, context
      FROM app_logs
      WHERE request_id = ${requestId}
      ORDER BY id
    `;
  }

  test('records only accepted actions and reads them back by target and request', async () => {
    const app = buildApp(true);
    const created = await send(app, 'POST', '/api/v1/monitor/targets', 'req-create', {
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: '操作稿',
      tags: ['alpha'],
      intervalMode: 'auto',
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { created: boolean; target: { id: string } };
    expect(createdBody.created).toBe(true);
    const targetId = createdBody.target.id;
    const createdRows = await eventsFor('req-create');
    expect(createdRows.map((row) => row.event)).toEqual(['monitor.target.created']);

    const exists = await send(app, 'POST', '/api/v1/monitor/targets', 'req-exists', {
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: '操作稿',
      tags: [],
      intervalMode: 'auto',
    });
    expect(exists.status).toBe(200);
    expect(((await exists.json()) as { created: boolean }).created).toBe(false);
    expect(await eventsFor('req-exists')).toEqual([]);

    const tags = await send(app, 'PATCH', `/api/v1/monitor/targets/${targetId}`, 'req-tags', {
      tags: ['beta'],
    });
    expect(tags.status).toBe(200);
    const tagRows = await eventsFor('req-tags');
    expect(tagRows.map((row) => row.event)).toEqual(['monitor.target.tags']);
    expect(JSON.stringify(tagRows)).not.toContain('monitor.target.resumed');
    expect(JSON.stringify(tagRows[0]?.context)).toContain('beta');

    const sameLabel = await send(app, 'PATCH', `/api/v1/monitor/targets/${targetId}`, 'req-same', {
      label: '操作稿',
    });
    expect(sameLabel.status).toBe(200);
    expect(await eventsFor('req-same')).toEqual([]);

    const paused = await send(app, 'PATCH', `/api/v1/monitor/targets/${targetId}`, 'req-pause', {
      enabled: false,
    });
    expect(paused.status).toBe(200);
    expect((await eventsFor('req-pause')).map((row) => row.event)).toEqual([
      'monitor.target.paused',
    ]);

    const resumed = await send(app, 'PATCH', `/api/v1/monitor/targets/${targetId}`, 'req-resume', {
      enabled: true,
    });
    expect(resumed.status).toBe(200);
    expect((await eventsFor('req-resume')).map((row) => row.event)).toEqual([
      'monitor.target.resumed',
    ]);

    const interval = await send(
      app,
      'PATCH',
      `/api/v1/monitor/targets/${targetId}`,
      'req-interval',
      {
        intervalMinutes: 240,
        intervalMode: 'fixed',
      },
    );
    expect(interval.status).toBe(200);
    const intervalRows = await eventsFor('req-interval');
    expect(intervalRows.map((row) => row.event)).toEqual(['monitor.target.interval']);
    const intervalContext = JSON.stringify(intervalRows[0]?.context);
    expect(intervalContext).toContain('240');
    expect(intervalContext).toContain('fixed');
    expect(intervalContext).not.toContain('monitor.target.resumed');

    const renamed = await send(app, 'PATCH', `/api/v1/monitor/targets/${targetId}`, 'req-rename', {
      label: '新名称',
    });
    expect(renamed.status).toBe(200);
    expect((await eventsFor('req-rename')).map((row) => row.event)).toEqual([
      'monitor.target.renamed',
    ]);

    const restore = freezeDate(new Date('2026-10-21T03:04:05.000Z'));
    try {
      // Create already left a pending; reuse must not invent a second active job.
      const reuseRun = await send(
        app,
        'POST',
        `/api/v1/monitor/targets/${targetId}/run`,
        'req-run-reuse',
        {},
      );
      expect(reuseRun.status).toBe(200);
      expect(((await reuseRun.json()) as { created: boolean }).created).toBe(false);
      expect(await eventsFor('req-run-reuse')).toEqual([]);

      if (!sql) throw new Error('sql missing');
      await sql`
        UPDATE collector_jobs
        SET status = 'succeeded', finished_at = statement_timestamp(), updated_at = statement_timestamp()
        WHERE target_id = ${targetId}::uuid AND status = 'pending'
      `;

      const firstRun = await send(
        app,
        'POST',
        `/api/v1/monitor/targets/${targetId}/run`,
        'req-run',
        {},
      );
      expect(firstRun.status).toBe(200);
      expect(((await firstRun.json()) as { created: boolean }).created).toBe(true);
      const secondRun = await send(
        app,
        'POST',
        `/api/v1/monitor/targets/${targetId}/run`,
        'req-run-exists',
        {},
      );
      expect(secondRun.status).toBe(200);
      expect(((await secondRun.json()) as { created: boolean }).created).toBe(false);
    } finally {
      restore();
    }
    expect((await eventsFor('req-run')).map((row) => row.event)).toEqual(['monitor.target.run']);
    expect(await eventsFor('req-run-exists')).toEqual([]);

    const removed = await send(app, 'DELETE', `/api/v1/monitor/targets/${targetId}`, 'req-remove');
    expect(removed.status).toBe(200);
    expect((await eventsFor('req-remove')).map((row) => row.event)).toEqual([
      'monitor.target.removed',
    ]);

    const rejected = await send(
      app,
      'PATCH',
      `/api/v1/monitor/targets/${targetId}`,
      'req-rejected',
      {
        enabled: false,
      },
    );
    expect(rejected.status).toBe(409);
    expect(await eventsFor('req-rejected')).toEqual([]);

    const invalid = await send(app, 'POST', '/api/v1/monitor/targets', 'req-invalid', {
      type: 'video',
    });
    expect(invalid.status).toBe(400);
    expect(await eventsFor('req-invalid')).toEqual([]);

    const missing = await send(
      app,
      'POST',
      '/api/v1/monitor/targets/00000000-0000-4000-8000-000000000077/run',
      'req-missing',
      {},
    );
    expect(missing.status).toBe(404);
    expect(await eventsFor('req-missing')).toEqual([]);

    const listed = parseOpsOperationList(
      await (
        await app.request(`/api/v1/ops/operations?targetId=${targetId}&${RANGE}&pageSize=50`)
      ).json(),
    );
    expect(
      listed.items
        .map((item) => item.action)
        .sort()
        .join(','),
    ).toBe(
      ['create', 'interval', 'pause', 'remove', 'rename', 'resume', 'run', 'tags'].sort().join(','),
    );
    const removedEvent = listed.items.find((item) => item.action === 'remove');
    expect(removedEvent?.externalId).toBe('BV1xx411c7mD');
    expect(removedEvent?.actor).toBeNull();
    expect(removedEvent?.source).toBe('api');
    const byRequest = parseOpsOperationList(
      await (await app.request(`/api/v1/ops/operations?requestId=req-tags&${RANGE}`)).json(),
    );
    expect(byRequest.items.map((item) => item.event)).toEqual(['monitor.target.tags']);
    expect(byRequest.total).toBe(1);
  });

  test('does not invent an operation row when no logger is attached', async () => {
    const app = buildApp(false);
    const response = await send(app, 'POST', '/api/v1/monitor/targets', 'req-no-logger', {
      type: 'creator',
      externalId: '99',
      label: '无日志',
      tags: [],
      intervalMode: 'auto',
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { created: boolean }).created).toBe(true);
    expect(await eventsFor('req-no-logger')).toEqual([]);
  });
});

async function send(
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
  method: string,
  path: string,
  requestId: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  };
  if (method !== 'DELETE' && body !== undefined) init.body = JSON.stringify(body);
  return Promise.resolve(app.request(path, init));
}

function freezeDate(at: Date): () => void {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(at.getTime());
        return;
      }
      super(...(args as ConstructorParameters<typeof RealDate>));
    }

    static override now(): number {
      return at.getTime();
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}
