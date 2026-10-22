import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseCommercialIngressBatchResponse,
  parseCommercialIngressError,
  parseCommercialIngressUpsertResponse,
  parseCommercialProjectList,
  parseCommercialSourceLookupResponse,
  type CommercialIngressUpsertItem,
} from '@studio/contracts';
import {
  createRetainedTestDatabase,
  countCommercialFixtureRows,
  expectedCommercialFixtureCounts,
  FIXTURE_PROJECT_IDS,
  seedCommercialFixtures,
  type Sql,
} from '@studio/db';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

const RETAINED_PREFIX = 'wp_r2_19a';

function item(
  sourceId: string,
  overrides: Partial<CommercialIngressUpsertItem> = {},
): CommercialIngressUpsertItem {
  return {
    sourceKey: { namespace: 'hermes.fixture', sourceId },
    originKind: 'fixture',
    sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
    name: `受控接入 ${sourceId}`,
    netAmount: '1200.00',
    rebateAmount: null,
    sourceStatus: '跟进中',
    sourceNotes: '不推断节点完成',
    payload: { title: `受控接入 ${sourceId}`, fixture: true },
    evidence: { kind: 'controlled-fixture', sourceId },
    ...overrides,
  };
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('commercial ingress foundation (WP-R2-19A)', () => {
  let sql: Sql;
  let databaseName = '';
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const isolated = await createRetainedTestDatabase(RETAINED_PREFIX);
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    await seedCommercialFixtures(sql);
    app = createApp({ skipDb: true });
    mountApiRoutes(app, sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    // Retained DB: do not DROP.
    console.log(`retained commercial ingress db: ${databaseName}`);
  });

  test('preserves declared fixture projects and marks origin_kind=fixture only', async () => {
    const expected = await expectedCommercialFixtureCounts(sql);
    const actual = await countCommercialFixtureRows(sql);
    expect(actual.commercialProjects).toBe(expected.commercialProjects);
    expect(actual.projectWorkflows).toBe(expected.projectWorkflows);
    expect(actual.wfNodes).toBe(expected.wfNodes);

    const [fixtureKinds] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM commercial_projects
      WHERE id = ANY(${Object.values(FIXTURE_PROJECT_IDS)})
        AND origin_kind = 'fixture'
    `;
    expect(Number(fixtureKinds?.c)).toBe(Object.values(FIXTURE_PROJECT_IDS).length);

    const [nonFixtureMarked] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM commercial_projects
      WHERE id <> ALL(${Object.values(FIXTURE_PROJECT_IDS)})
        AND origin_kind = 'fixture'
    `;
    expect(Number(nonFixtureMarked?.c)).toBe(0);
  }, 30_000);

  test('single upsert creates project+workflow with not_reached nodes and source snapshot', async () => {
    const res = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({ item: item('single-1'), dryRun: false }),
    );
    expect(res.status).toBe(200);
    const body = parseCommercialIngressUpsertResponse(await res.json());
    expect(body.result.outcome).toBe('created');
    expect(body.result.projectId).toBeTruthy();
    expect(body.result.workflowId).toBeTruthy();

    const projectId = body.result.projectId!;
    const [nodeStats] = await sql<{ total: string; started: string }[]>`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE status <> 'not_reached')::text AS started
      FROM wf_nodes
      WHERE project_id = ${projectId}
    `;
    expect(Number(nodeStats?.total)).toBe(14);
    expect(Number(nodeStats?.started)).toBe(0);

    const lookup = parseCommercialSourceLookupResponse(
      await (
        await app.request('/api/v1/commercial/ingress/by-source/hermes.fixture/single-1')
      ).json(),
    );
    expect(lookup.source.payload).toEqual({ title: '受控接入 single-1', fixture: true });
    expect(lookup.source.sourceStatus).toBe('跟进中');
    expect(typeof lookup.source.payload).toBe('object');
  }, 30_000);

  test('dry-run leaves no project/source/audit rows', async () => {
    const beforeProjects = await sql<
      { c: string }[]
    >`SELECT count(*)::text AS c FROM commercial_projects`;
    const beforeSources = await sql<
      { c: string }[]
    >`SELECT count(*)::text AS c FROM commercial_project_sources`;
    const beforeAudit = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM domain_audit_events WHERE action LIKE 'ingress_%'
    `;

    const res = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({ item: item('dry-run-only'), dryRun: true }),
    );
    expect(res.status).toBe(200);
    const body = parseCommercialIngressUpsertResponse(await res.json());
    expect(body.result.outcome).toBe('would_create');
    expect(body.result.dryRun).toBe(true);
    expect(body.result.projectId).toBeNull();

    const afterProjects = await sql<
      { c: string }[]
    >`SELECT count(*)::text AS c FROM commercial_projects`;
    const afterSources = await sql<
      { c: string }[]
    >`SELECT count(*)::text AS c FROM commercial_project_sources`;
    const afterAudit = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM domain_audit_events WHERE action LIKE 'ingress_%'
    `;
    expect(afterProjects[0]?.c).toBe(beforeProjects[0]?.c);
    expect(afterSources[0]?.c).toBe(beforeSources[0]?.c);
    expect(afterAudit[0]?.c).toBe(beforeAudit[0]?.c);
  }, 30_000);

  test('idempotent replay keeps updatedAt and does not duplicate nodes or audit', async () => {
    const created = parseCommercialIngressUpsertResponse(
      await (
        await app.request('/api/v1/commercial/ingress/upsert', json({ item: item('idem-1') }))
      ).json(),
    );
    const projectId = created.result.projectId!;
    const firstUpdatedAt = created.result.projectUpdatedAt;
    const [auditBefore] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM domain_audit_events WHERE project_id = ${projectId}
    `;
    const [nodesBefore] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes WHERE project_id = ${projectId}
    `;

    const replay = parseCommercialIngressUpsertResponse(
      await (
        await app.request('/api/v1/commercial/ingress/upsert', json({ item: item('idem-1') }))
      ).json(),
    );
    expect(replay.result.outcome).toBe('idempotent_replay');
    expect(replay.result.projectUpdatedAt).toBe(firstUpdatedAt);

    const [auditAfter] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM domain_audit_events WHERE project_id = ${projectId}
    `;
    const [nodesAfter] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes WHERE project_id = ${projectId}
    `;
    expect(auditAfter?.c).toBe(auditBefore?.c);
    expect(nodesAfter?.c).toBe(nodesBefore?.c);
  }, 30_000);

  test('same version different content conflicts; older source version is rejected', async () => {
    await app.request('/api/v1/commercial/ingress/upsert', json({ item: item('conflict-1') }));

    const sameVersion = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({
        item: item('conflict-1', {
          name: '不同内容',
          payload: { title: '不同内容', fixture: true },
        }),
      }),
    );
    expect(sameVersion.status).toBe(409);
    expect(parseCommercialIngressError(await sameVersion.json()).code).toBe(
      'same_version_content_conflict',
    );

    const older = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({
        item: item('conflict-1', { sourceUpdatedAt: '2025-01-01T00:00:00.000Z' }),
      }),
    );
    expect(older.status).toBe(409);
    expect(parseCommercialIngressError(await older.json()).code).toBe('stale_source_version');
  }, 30_000);

  test('web hand-edit conflict requires matching expectedUpdatedAt; no force bypass', async () => {
    const created = parseCommercialIngressUpsertResponse(
      await (
        await app.request('/api/v1/commercial/ingress/upsert', json({ item: item('hand-edit-1') }))
      ).json(),
    );
    const projectId = created.result.projectId!;
    await sql`
      UPDATE commercial_projects SET name = '网页手改名', updated_at = now() WHERE id = ${projectId}
    `;
    const [row] = await sql<{ updated_at: string }[]>`
      SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
      FROM commercial_projects WHERE id = ${projectId}
    `;

    const missingToken = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({
        item: item('hand-edit-1', {
          sourceUpdatedAt: '2026-11-01T00:00:00.000Z',
          name: '源同步尝试覆盖',
        }),
      }),
    );
    expect(missingToken.status).toBe(409);
    expect(parseCommercialIngressError(await missingToken.json()).code).toBe(
      'expected_updated_at_required',
    );

    const staleToken = created.result.projectUpdatedAt;
    expect(staleToken).toBeTruthy();
    const stale = await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({
        item: item('hand-edit-1', {
          sourceUpdatedAt: '2026-11-01T00:00:00.000Z',
          name: '源同步尝试覆盖',
          expectedUpdatedAt: staleToken!,
        }),
      }),
    );
    expect(stale.status).toBe(409);
    expect(parseCommercialIngressError(await stale.json()).code).toBe('stale_write');

    expect(row?.updated_at).toBeTruthy();
    const ok = parseCommercialIngressUpsertResponse(
      await (
        await app.request(
          '/api/v1/commercial/ingress/upsert',
          json({
            item: item('hand-edit-1', {
              sourceUpdatedAt: '2026-11-01T00:00:00.000Z',
              name: '受保护更新',
              expectedUpdatedAt: row!.updated_at,
              payload: { title: '受保护更新', fixture: true },
            }),
          }),
        )
      ).json(),
    );
    expect(ok.result.outcome).toBe('updated');
    const [nameRow] = await sql<{ name: string }[]>`
      SELECT name FROM commercial_projects WHERE id = ${projectId}
    `;
    expect(nameRow?.name).toBe('受保护更新');
  }, 30_000);

  test('batch is atomic: duplicate key or mid-batch failure rolls back with no orphans', async () => {
    const before = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM commercial_project_sources WHERE namespace = 'hermes.fixture'
        AND source_id LIKE 'batch-atom-%'
    `;

    const dup = await app.request(
      '/api/v1/commercial/ingress/batch',
      json({
        items: [item('batch-atom-a'), item('batch-atom-a')],
      }),
    );
    expect(dup.status).toBe(400);
    expect(parseCommercialIngressError(await dup.json()).code).toBe('duplicate_source_key');

    await app.request(
      '/api/v1/commercial/ingress/upsert',
      json({ item: item('batch-atom-exist') }),
    );
    const fail = await app.request(
      '/api/v1/commercial/ingress/batch',
      json({
        items: [
          item('batch-atom-new'),
          item('batch-atom-exist', {
            sourceUpdatedAt: '2025-01-01T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(fail.status).toBe(409);
    expect(parseCommercialIngressError(await fail.json()).code).toBe('stale_source_version');

    const after = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM commercial_project_sources WHERE namespace = 'hermes.fixture'
        AND source_id = 'batch-atom-new'
    `;
    expect(after[0]?.c).toBe('0');
    expect(before[0]?.c).toBeDefined();
  }, 30_000);

  test('batch success upserts multiple keys with stable ordering', async () => {
    const res = await app.request(
      '/api/v1/commercial/ingress/batch',
      json({
        items: [item('batch-z'), item('batch-a'), item('batch-m')],
      }),
    );
    expect(res.status).toBe(200);
    const body = parseCommercialIngressBatchResponse(await res.json());
    expect(body.results.map((r) => r.sourceKey.sourceId)).toEqual([
      'batch-a',
      'batch-m',
      'batch-z',
    ]);
    expect(body.results.every((r) => r.outcome === 'created')).toBe(true);
  }, 30_000);

  test('concurrent same source creates only one project and one workflow', async () => {
    const payload = json({ item: item('concurrent-1') });
    const [a, b] = await Promise.all([
      app.request('/api/v1/commercial/ingress/upsert', payload),
      app.request('/api/v1/commercial/ingress/upsert', payload),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    // Second may be 200 idempotent or 409 unique depending on timing; never two projects.
    const sources = await sql<{ project_id: string }[]>`
      SELECT project_id FROM commercial_project_sources
      WHERE namespace = 'hermes.fixture' AND source_id = 'concurrent-1'
    `;
    expect(sources).toHaveLength(1);
    const workflows = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM project_workflows WHERE project_id = ${sources[0]!.project_id}
    `;
    expect(workflows[0]?.c).toBe('1');
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
  }, 30_000);

  test('originKind filter returns count/pagination and honest empty real view', async () => {
    const fixtures = parseCommercialProjectList(
      await (
        await app.request('/api/v1/commercial/projects?originKind=fixture&limit=5&offset=0')
      ).json(),
    );
    expect(fixtures.total).toBeGreaterThanOrEqual(Object.values(FIXTURE_PROJECT_IDS).length);
    expect(fixtures.limit).toBe(5);
    expect(fixtures.offset).toBe(0);
    expect(fixtures.items.length).toBeLessThanOrEqual(5);
    expect(fixtures.items.every((p) => p.originKind === 'fixture')).toBe(true);

    const real = parseCommercialProjectList(
      await (await app.request('/api/v1/commercial/projects?originKind=real')).json(),
    );
    expect(real.total).toBe(0);
    expect(real.items).toEqual([]);
  }, 30_000);

  test('null amounts stay null and source status does not complete nodes', async () => {
    const res = parseCommercialIngressUpsertResponse(
      await (
        await app.request(
          '/api/v1/commercial/ingress/upsert',
          json({
            item: item('null-money', {
              netAmount: null,
              rebateAmount: null,
              sourceStatus: '已结算',
              sourceNotes: '这不是资金闭环证明',
            }),
          }),
        )
      ).json(),
    );
    const projectId = res.result.projectId!;
    const [row] = await sql<{ net_amount: string | null; rebate_amount: string | null }[]>`
      SELECT net_amount::text AS net_amount, rebate_amount::text AS rebate_amount
      FROM commercial_projects WHERE id = ${projectId}
    `;
    expect(row?.net_amount).toBeNull();
    expect(row?.rebate_amount).toBeNull();
    const [completed] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes
      WHERE project_id = ${projectId} AND status = 'completed'
    `;
    expect(completed?.c).toBe('0');
  }, 30_000);
});
