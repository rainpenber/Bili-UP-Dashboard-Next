import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialRebateError,
  parseCommercialRebateListResponse,
  parseCommercialRebateResponse,
  type CommercialRebate,
} from '@studio/contracts';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  isPostgresRequiredEnv,
  type Sql,
} from '@studio/db';
import { createApp } from './app';
import { createCommercialRoutes } from './commercial-routes';

const PROJECT_ID = 'bb150001-0001-4001-8001-000000000001';

describe('commercial rebate ledger API', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) {
      if (isPostgresRequiredEnv()) {
        throw new Error('PostgreSQL required in CI but isolated database setup failed');
      }
      return;
    }
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    app = createApp({ skipDb: true });
    app.route('/api/v1/commercial', createCommercialRoutes(sql));
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  async function list(): Promise<CommercialRebate[]> {
    if (!app) throw new Error('app missing');
    const res = await app.request('/api/v1/commercial/rebates');
    expect(res.status).toBe(200);
    return parseCommercialRebateListResponse(await res.json()).items;
  }

  function patch(id: string, body: Record<string, unknown>) {
    if (!app) throw new Error('app missing');
    return app.request(`/api/v1/commercial/rebates/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('returns the 12 seeded rows and split outstanding totals', async () => {
    if (!sql || !app) return;
    const res = await app.request('/api/v1/commercial/rebates');
    expect(res.status).toBe(200);
    const body = parseCommercialRebateListResponse(await res.json());
    expect(body.items).toHaveLength(12);
    expect(body.summary.outstandingTotal).toBe('30912.40');
    expect(body.summary.outstandingPlatformPaid).toBe('0.00');
    expect(body.summary.outstandingPlatformUnpaid).toBe('30912.40');
    expect(body.summary.openCount).toBe(4);
    expect(body.summary.settledThisYear).toBe('76650.00');
    expect(body.items.filter((item) => item.isReturned)).toHaveLength(8);
    expect(body.items.find((item) => item.projectName === 'plaud ai录音笔')?.contractState).toBe(
      'sent',
    );
  });

  test('marks returned with CURRENT_DATE and clears the date when unchecked', async () => {
    if (!sql || !app) return;
    const plaud = (await list()).find((item) => item.projectName === 'plaud ai录音笔');
    if (!plaud) throw new Error('plaud seed missing');

    const returned = parseCommercialRebateResponse(
      await (
        await patch(plaud.id, {
          isReturned: true,
          expectedUpdatedAt: plaud.updatedAt,
        })
      ).json(),
    );
    expect(returned.isReturned).toBe(true);
    expect(returned.returnedAt).not.toBeNull();
    expect(Number(returned.returnedAt?.slice(0, 4))).toBe(new Date().getUTCFullYear());

    const cleared = parseCommercialRebateResponse(
      await (
        await patch(plaud.id, {
          isReturned: false,
          expectedUpdatedAt: returned.updatedAt,
        })
      ).json(),
    );
    expect(cleared.isReturned).toBe(false);
    expect(cleared.returnedAt).toBeNull();

    const [audit] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events
      WHERE entity_type = 'commercial_rebate' AND entity_id = ${plaud.id}
    `;
    expect(audit?.count).toBe('2');
  });

  test('rejects a stale expectedUpdatedAt', async () => {
    if (!sql || !app) return;
    const item = (await list()).find((row) => row.projectName === '树新风空气净化器');
    if (!item) throw new Error('tree seed missing');
    const res = await patch(item.id, {
      note: 'stale',
      expectedUpdatedAt: '2020-01-01T00:00:00.000000Z',
    });
    expect(res.status).toBe(409);
    expect(parseCommercialRebateError(await res.json()).code).toBe('stale_write');
  });

  test('linked rows read the project amount and refuse expectedAmount edits', async () => {
    if (!sql || !app) return;
    await sql`
      INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, origin_kind)
      VALUES (${PROJECT_ID}, '联调返点项目', 28080.00, 8888.88, 'published_winding_down', 'real')
    `;
    await sql`
      INSERT INTO commercial_project_sources (
        id, project_id, namespace, source_id, origin_kind,
        source_updated_at, imported_at, payload, content_hash, source_status
      ) VALUES (
        ${'bb150002-0001-4001-8001-000000000002'}, ${PROJECT_ID}, 'hermes.test', 'rebate-linked-1', 'real',
        ${'2026-11-01T00:00:00.000Z'}, ${'2026-11-01T00:00:00.000Z'}, '{}'::jsonb,
        'hash-rebate-linked', '3.收尾-已提现'
      )
    `;
    const createdRes = await app.request('/api/v1/commercial/rebates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        projectName: '联调返点项目',
        contractState: 'signed',
      }),
    });
    expect(createdRes.status).toBe(201);
    const created = parseCommercialRebateResponse(await createdRes.json());
    expect(created.projectId).toBe(PROJECT_ID);
    expect(created.expectedAmount).toBe('8888.88');
    expect(created.platformPaid).toBe(true);

    const locked = await patch(created.id, {
      expectedAmount: '9000.00',
      expectedUpdatedAt: created.updatedAt,
    });
    expect(locked.status).toBe(409);
    expect(parseCommercialRebateError(await locked.json()).code).toBe('amount_locked');
    const [snapshot] = await sql<{ expected_amount: string | null }[]>`
      SELECT expected_amount::text AS expected_amount FROM commercial_rebates WHERE id = ${created.id}
    `;
    expect(snapshot?.expected_amount).toBeNull();

    await sql`
      UPDATE commercial_projects SET rebate_amount = 9000.00 WHERE id = ${PROJECT_ID}
    `;
    const after = (await list()).find((item) => item.id === created.id);
    expect(after?.expectedAmount).toBe('9000.00');

    const noted = parseCommercialRebateResponse(
      await (
        await patch(created.id, {
          note: '改价后按项目金额',
          expectedUpdatedAt: created.updatedAt,
        })
      ).json(),
    );
    expect(noted.note).toBe('改价后按项目金额');
  });

  test('historical rows keep expectedAmount and reject a blank amount', async () => {
    if (!sql || !app) return;
    const historical = (await list()).find((item) => item.projectId === null && !item.isReturned);
    if (!historical) throw new Error('historical open row missing');
    const blank = await patch(historical.id, {
      expectedAmount: null,
      expectedUpdatedAt: historical.updatedAt,
    });
    expect(blank.status).toBe(400);

    const missing = await app.request('/api/v1/commercial/rebates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: '无金额历史项目' }),
    });
    expect(missing.status).toBe(400);

    const duplicate = await app.request('/api/v1/commercial/rebates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'plaud ai录音笔', expectedAmount: '4950.00' }),
    });
    expect(duplicate.status).toBe(409);
    expect(parseCommercialRebateError(await duplicate.json()).code).toBe('duplicate_project');
  });
});
