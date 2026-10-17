import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import {
  FIXTURE_PROJECT_IDS,
  countCommercialFixtureRows,
  expectedCommercialFixtureCounts,
  seedCommercialFixtures,
} from './commercial-fixtures';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('commercial fixtures', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let expected: Awaited<ReturnType<typeof expectedCommercialFixtureCounts>> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (sql) {
      expected = await expectedCommercialFixtureCounts(sql);
    }
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('seed is idempotent for fixture table counts', async () => {
    assertIntegrationSql(sql);
    if (!expected) throw new Error('expected fixture counts not computed');

    await seedCommercialFixtures(sql);
    const afterFirst = await countCommercialFixtureRows(sql);
    expect(afterFirst).toEqual(expected);

    await seedCommercialFixtures(sql);
    const afterSecond = await countCommercialFixtureRows(sql);
    expect(afterSecond).toEqual(expected);
    expect(afterSecond).toEqual(afterFirst);

    const [mergeNodes] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM wf_nodes
      WHERE project_id = ANY(${Object.values(FIXTURE_PROJECT_IDS)})
        AND kind = 'merge'
        AND name = '汇合节点'
    `;
    expect(Number(mergeNodes?.c)).toBe(expected.commercialProjects);
  }, 30_000);

  test('re-seed restores blocked nodes and their open blocking items', async () => {
    assertIntegrationSql(sql);
    await seedCommercialFixtures(sql);
    await expectFixtureBlockInvariant(sql);

    const bRoll = await fixtureNode(sql, FIXTURE_PROJECT_IDS.multiBlock, 'b_roll');
    const aRoll = await fixtureNode(sql, FIXTURE_PROJECT_IDS.multiBlock, 'a_roll');
    const copy = await fixtureNode(sql, FIXTURE_PROJECT_IDS.clientBlocking, 'copy');
    if (!bRoll || !aRoll || !copy) throw new Error('fixture block nodes missing');

    await sql`
      UPDATE open_items
      SET lifecycle = 'closed', closed_at = now(), updated_at = now()
      WHERE id = ${bRoll.item_id}
    `;
    await sql`
      UPDATE wf_nodes
      SET status = 'in_progress', primary_block_pinned_item_id = NULL, status_before_block = NULL, updated_at = now()
      WHERE id = ${aRoll.id}
    `;
    await sql`
      UPDATE wf_nodes
      SET status = 'completed', primary_block_pinned_item_id = NULL, status_before_block = NULL, updated_at = now()
      WHERE id = ${copy.id}
    `;
    await sql`
      UPDATE wf_nodes
      SET primary_block_pinned_item_id = NULL, status_before_block = NULL, updated_at = now()
      WHERE id = ${bRoll.id}
    `;

    const driftedReason = await nodeBlockingReason(sql, bRoll.id);
    expect(driftedReason).toBeNull();

    await seedCommercialFixtures(sql);

    const repaired = await fixtureNode(sql, FIXTURE_PROJECT_IDS.multiBlock, 'b_roll');
    expect(repaired?.status).toBe('blocked');
    expect(repaired?.primary_block_pinned_item_id).toBeTruthy();
    expect(repaired?.status_before_block).toBe('in_progress');
    expect(repaired?.item_lifecycle).toBe('open');
    expect(await nodeBlockingReason(sql, bRoll.id)).toBe('B-roll 甲方素材缺失');

    const repairedA = await fixtureNode(sql, FIXTURE_PROJECT_IDS.multiBlock, 'a_roll');
    expect(repairedA?.status).toBe('blocked');
    expect(repairedA?.item_title).toBe('A-roll 素材版权待补');
    expect(repairedA?.primary_block_pinned_item_id).toBe(repairedA?.item_id);

    const repairedCopy = await fixtureNode(sql, FIXTURE_PROJECT_IDS.clientBlocking, 'copy');
    expect(repairedCopy?.status).toBe('blocked');
    expect(repairedCopy?.item_lifecycle).toBe('open');
    expect(repairedCopy?.item_title).toBe('甲方文案批注未清');
    expect(repairedCopy?.primary_block_pinned_item_id).toBe(repairedCopy?.item_id);
    expect(repairedCopy?.status_before_block).toBe('in_progress');

    await expectFixtureBlockInvariant(sql);
    await seedCommercialFixtures(sql);
    await expectFixtureBlockInvariant(sql);
  }, 30_000);
});

type FixtureNodeLink = {
  id: string;
  status: string;
  primary_block_pinned_item_id: string | null;
  status_before_block: string | null;
  item_id: string | null;
  item_title: string | null;
  item_lifecycle: string | null;
};

async function fixtureNode(
  sql: Sql,
  projectId: string,
  slug: string,
): Promise<FixtureNodeLink | undefined> {
  const [row] = await sql<FixtureNodeLink[]>`
    SELECT
      n.id,
      n.status,
      n.primary_block_pinned_item_id,
      n.status_before_block,
      oi.id AS item_id,
      oi.title AS item_title,
      oi.lifecycle AS item_lifecycle
    FROM wf_nodes n
    JOIN wf_template_nodes t ON t.id = n.template_node_id
    LEFT JOIN open_items oi
      ON oi.project_id = n.project_id
     AND oi.blocks_node_id = n.id
     AND oi.impact = 'blocking'
    WHERE n.project_id = ${projectId}
      AND t.slug = ${slug}
  `;
  return row;
}

async function nodeBlockingReason(sql: Sql, nodeId: string): Promise<string | null> {
  const [row] = await sql<{ blocking_reason: string | null }[]>`
    SELECT (
      SELECT oi.title
      FROM open_items oi
      WHERE n.status = 'blocked'
        AND oi.project_id = n.project_id
        AND oi.lifecycle = 'open'
        AND oi.impact = 'blocking'
        AND (
          oi.id = n.primary_block_pinned_item_id
          OR oi.blocks_node_id = n.id
        )
      ORDER BY
        (oi.id = n.primary_block_pinned_item_id) DESC,
        oi.sort_rank ASC,
        oi.created_at ASC,
        oi.id ASC
      LIMIT 1
    ) AS blocking_reason
    FROM wf_nodes n
    WHERE n.id = ${nodeId}
  `;
  return row?.blocking_reason ?? null;
}

async function expectFixtureBlockInvariant(sql: Sql): Promise<void> {
  const fixtureIds = Object.values(FIXTURE_PROJECT_IDS);
  const blockedWithoutItem = await sql<{ id: string }[]>`
    SELECT n.id
    FROM wf_nodes n
    WHERE n.project_id = ANY(${fixtureIds})
      AND n.status = 'blocked'
      AND NOT EXISTS (
        SELECT 1
        FROM open_items oi
        WHERE oi.project_id = n.project_id
          AND oi.lifecycle = 'open'
          AND oi.impact = 'blocking'
          AND (
            oi.id = n.primary_block_pinned_item_id
            OR oi.blocks_node_id = n.id
          )
      )
  `;
  const itemWithoutBlocked = await sql<{ id: string }[]>`
    SELECT oi.id
    FROM open_items oi
    WHERE oi.project_id = ANY(${fixtureIds})
      AND oi.lifecycle = 'open'
      AND oi.impact = 'blocking'
      AND NOT EXISTS (
        SELECT 1
        FROM wf_nodes n
        WHERE n.project_id = oi.project_id
          AND n.status = 'blocked'
          AND (
            n.primary_block_pinned_item_id = oi.id
            OR oi.blocks_node_id = n.id
          )
      )
  `;
  const missingPin = await sql<{ id: string }[]>`
    SELECT n.id
    FROM wf_nodes n
    WHERE n.project_id = ANY(${fixtureIds})
      AND n.status = 'blocked'
      AND (
        n.primary_block_pinned_item_id IS NULL
        OR n.status_before_block IS NULL
        OR n.status_before_block = 'blocked'
      )
  `;
  const pinnedWhileOpen = await sql<{ id: string }[]>`
    SELECT n.id
    FROM wf_nodes n
    WHERE n.project_id = ANY(${fixtureIds})
      AND n.status <> 'blocked'
      AND (
        n.primary_block_pinned_item_id IS NOT NULL
        OR n.status_before_block IS NOT NULL
      )
  `;
  expect(blockedWithoutItem).toEqual([]);
  expect(itemWithoutBlocked).toEqual([]);
  expect(missingPin).toEqual([]);
  expect(pinnedWhileOpen).toEqual([]);
}
