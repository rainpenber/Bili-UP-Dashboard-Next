import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

const PUBLISHED_AT = '2026-10-20T12:00:00.000Z';

async function insertProject(sql: Sql, name: string): Promise<string> {
  const projectId = crypto.randomUUID();
  await sql`INSERT INTO commercial_projects (id, name) VALUES (${projectId}, ${name})`;
  return projectId;
}

describe('project publish records for non-video deliveries', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('a post record stores content identity with a null bvid', async () => {
    assertIntegrationSql(sql);
    const projectId = await insertProject(sql, 'Post delivery');
    await sql`
      INSERT INTO project_publish_records (
        project_id, bvid, published_at, idempotency_key,
        content_kind, content_url, external_id
      ) VALUES (
        ${projectId}, NULL, ${PUBLISHED_AT}, 'post-once',
        'post', 'https://t.bilibili.com/1262617308018245635', '1262617308018245635'
      )
    `;
    const [row] = await sql<
      {
        bvid: string | null;
        platform: string;
        content_kind: string;
        content_url: string | null;
        external_id: string | null;
      }[]
    >`
      SELECT bvid, platform, content_kind, content_url, external_id
      FROM project_publish_records
      WHERE project_id = ${projectId}
    `;
    expect(row).toEqual({
      bvid: null,
      platform: 'bilibili',
      content_kind: 'post',
      content_url: 'https://t.bilibili.com/1262617308018245635',
      external_id: '1262617308018245635',
    });
  });

  test('existing video inserts still default to bilibili and video', async () => {
    assertIntegrationSql(sql);
    const projectId = await insertProject(sql, 'Video delivery');
    await sql`
      INSERT INTO project_publish_records (
        project_id, bvid, published_at, idempotency_key
      ) VALUES (${projectId}, 'BV1defaults01', ${PUBLISHED_AT}, 'video-once')
    `;
    const [row] = await sql<
      {
        bvid: string | null;
        platform: string;
        content_kind: string;
        content_url: string | null;
        external_id: string | null;
      }[]
    >`
      SELECT bvid, platform, content_kind, content_url, external_id
      FROM project_publish_records
      WHERE project_id = ${projectId}
    `;
    expect(row).toEqual({
      bvid: 'BV1defaults01',
      platform: 'bilibili',
      content_kind: 'video',
      content_url: null,
      external_id: null,
    });
  });

  test('identity and kind check constraints reject invalid rows', async () => {
    assertIntegrationSql(sql);
    const projectId = await insertProject(sql, 'Invalid deliveries');

    let identityError: unknown;
    try {
      await sql`
        INSERT INTO project_publish_records (
          project_id, bvid, published_at, idempotency_key, content_kind
        ) VALUES (${projectId}, NULL, ${PUBLISHED_AT}, 'no-identity', 'post')
      `;
    } catch (err) {
      identityError = err;
    }
    expect(String(identityError)).toMatch(/project_publish_records_identity_chk/);

    let kindError: unknown;
    try {
      await sql`
        INSERT INTO project_publish_records (
          project_id, bvid, published_at, idempotency_key, content_kind
        ) VALUES (${projectId}, 'BV1invalid01', ${PUBLISHED_AT}, 'bad-kind', 'article')
      `;
    } catch (err) {
      kindError = err;
    }
    expect(String(kindError)).toMatch(/project_publish_records_kind_chk/);
  });
});
