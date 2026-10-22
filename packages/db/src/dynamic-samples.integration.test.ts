import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql, type Sql } from './client';
import { readDbConfigFromEnv } from './config';
import {
  runMigrations,
  writeCreatorSample,
  writeDynamicSample,
  writeDynamicSampleWithin,
  writeVideoSample,
  type DynamicSampleWrite,
} from './index';
import { postgresAvailable } from './postgres-available';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const IDENT = /^[a-z_][a-z0-9_]*$/;

type TextRow = Record<string, string | null>;

const HISTORY_DYNAMIC = '8512345678901234567';
const HISTORY_DYNAMIC_B = '9223372036854775808123';
const HISTORY_MID = '8047632';
const HISTORY_MID_MAX = '9223372036854775807';
const HISTORY_BATCH = '16b11111-1111-4111-8111-111111111111';

function sampleInput(overrides: Partial<DynamicSampleWrite> = {}): DynamicSampleWrite {
  return {
    dynamicId: '8510000000000000001',
    dynamicType: 'DYNAMIC_TYPE_DRAW',
    visible: true,
    authorMid: '35100000011',
    authorName: '作者甲',
    faceUrl: 'https://example.test/face.jpg',
    publishedAt: new Date('2024-08-20T11:17:00.000Z'),
    publishedText: '2024年08月20日 19:17',
    text: '正文甲',
    majorType: 'MAJOR_TYPE_DRAW',
    likeCount: 0n,
    repostCount: null,
    commentCount: 1n,
    sampledAt: new Date('2026-04-01T00:00:00.000Z'),
    rawTime: '2026-04-01 08:00:00',
    sourceTimezone: 'Asia/Shanghai',
    timestampPrecision: 'second',
    source: 'bilibili',
    accountId: null,
    collectorRunId: null,
    collectedAt: new Date('2026-04-01T00:00:05.000Z'),
    extra: { marker: 'live', zero: 0 },
    ...overrides,
  };
}

async function createRetainedDatabase(prefix: string): Promise<{ sql: Sql; databaseName: string }> {
  if (!/^[a-z][a-z0-9_]{0,20}$/.test(prefix)) throw new Error(`invalid prefix: ${prefix}`);
  if (!(await postgresAvailable())) {
    throw new Error('PostgreSQL is required for dynamic sample storage tests. Refusing to skip.');
  }
  const cfg = readDbConfigFromEnv();
  const admin = createSql();
  const databaseName = `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const sql = createSql({ ...cfg, database: databaseName });
  await sql`SET TIME ZONE 'UTC'`;
  console.log(`RETAINED_DB ${databaseName}`);
  return { sql, databaseName };
}

async function applyMigrationsBefore(sql: Sql, versionCutoff: string): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (file >= versionCutoff) continue;
    const version = file.replace(/\.sql$/, '');
    await sql.unsafe(readFileSync(join(migrationsDir, file), 'utf8'));
    await sql`INSERT INTO schema_migrations (version) VALUES (${version})`;
  }
}

async function snapshotRows(sql: Sql, table: string, orderBy: string): Promise<TextRow[]> {
  if (!IDENT.test(table) || !IDENT.test(orderBy)) throw new Error('bad snapshot identifier');
  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  const names = columns.map((column) => {
    if (!IDENT.test(column.column_name)) throw new Error(`bad column ${column.column_name}`);
    return column.column_name;
  });
  const selectList = names.map((name) => `"${name}"::text AS "${name}"`).join(', ');
  return sql.unsafe(`SELECT ${selectList} FROM "${table}" ORDER BY "${orderBy}"`);
}

function expectSameFields(before: TextRow[], after: TextRow[], fields: string[]): void {
  expect(after.length).toBe(before.length);
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index];
    const right = after[index];
    if (!left || !right) throw new Error(`missing snapshot row ${index}`);
    for (const field of fields) {
      expect(right[field]).toBe(left[field]);
    }
  }
}

async function seedHistory(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO import_batches (
      id, mode, source_timezone, started_at, completed_at, report_json, content_fingerprint
    ) VALUES (
      ${HISTORY_BATCH}::uuid,
      'apply',
      'Asia/Shanghai',
      '2024-05-01T00:00:00Z',
      '2024-05-01T00:01:00Z',
      '{"kind":"history"}'::jsonb,
      'hist-fp'
    )
  `;
  const [file] = await sql<{ id: string }[]>`
    INSERT INTO source_files (
      batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count
    ) VALUES (
      ${HISTORY_BATCH}::uuid,
      '999_detailcount.csv',
      'histsha256',
      'canonical',
      'detailcount',
      ${HISTORY_DYNAMIC},
      2
    )
    RETURNING id::text AS id
  `;
  if (!file) throw new Error('历史来源文件没有写入');
  await sql`
    INSERT INTO creators (
      mid, uname, face_asset_id, category, monitoring_enabled, archived_at, deleted_at,
      metadata, created_at, updated_at, face_url, metadata_state, metadata_source,
      metadata_fetched_at, metadata_error
    ) VALUES (
      ${HISTORY_MID}::bigint,
      '历史作者',
      'asset-hist',
      '历史分类',
      false,
      '2024-01-02T00:00:00Z',
      NULL,
      '{"kept":"yes","n":0}'::jsonb,
      '2024-01-01T00:00:00Z',
      '2024-01-03T00:00:00Z',
      'https://history.example/face.png',
      'ok',
      'manual',
      '2024-01-04T00:00:00Z',
      '无'
    )
  `;
  await sql`
    INSERT INTO creators (
      mid, uname, category, monitoring_enabled, metadata, created_at, updated_at, metadata_state
    ) VALUES (
      ${HISTORY_MID_MAX}::bigint,
      NULL,
      NULL,
      false,
      '{"role":"max"}'::jsonb,
      '2024-01-05T00:00:00Z',
      '2024-01-06T00:00:00Z',
      'failed'
    )
  `;
  await sql`
    INSERT INTO dynamics (
      dynamic_id, mid, category, monitoring_enabled, archived_at, deleted_at,
      metadata, created_at, updated_at
    ) VALUES (
      ${HISTORY_DYNAMIC},
      ${HISTORY_MID}::bigint,
      '动态分类',
      false,
      '2024-02-02T00:00:00Z',
      '2024-03-03T00:00:00Z',
      '{"custom":"stay","n":0,"text":"旧正文"}'::jsonb,
      '2024-02-01T00:00:00Z',
      '2024-02-04T00:00:00Z'
    )
  `;
  await sql`
    INSERT INTO dynamics (
      dynamic_id, mid, category, monitoring_enabled, archived_at, deleted_at,
      metadata, created_at, updated_at
    ) VALUES (
      ${HISTORY_DYNAMIC_B},
      NULL,
      NULL,
      true,
      NULL,
      NULL,
      '{}'::jsonb,
      '2024-07-01T00:00:00Z',
      '2024-07-02T00:00:00Z'
    )
  `;
  await sql`
    INSERT INTO dynamic_metric_samples (
      dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
      like_count, repost_count, comment_count, import_batch_id, source_file_id
    ) VALUES (
      ${HISTORY_DYNAMIC},
      '2024-05-01T00:00:00Z',
      'Asia/Shanghai',
      '2024-05-01 08:00',
      'minute',
      0,
      NULL,
      0,
      ${HISTORY_BATCH}::uuid,
      ${file.id}::bigint
    )
  `;
  await sql`
    INSERT INTO dynamic_metric_samples (
      dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
      like_count, repost_count, comment_count, import_batch_id, source_file_id
    ) VALUES (
      ${HISTORY_DYNAMIC},
      '2024-06-01T00:00:01Z',
      'Asia/Shanghai',
      '2024-06-01 08:00:01',
      'second',
      NULL,
      0,
      NULL,
      NULL,
      NULL
    )
  `;
  await sql`
    INSERT INTO dynamic_metric_samples (
      dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
      like_count, repost_count, comment_count, import_batch_id, source_file_id
    ) VALUES (
      ${HISTORY_DYNAMIC_B},
      '2024-07-01T00:00:00Z',
      'Asia/Shanghai',
      '2024-07-01 08:00:00',
      'second',
      0,
      0,
      0,
      NULL,
      NULL
    )
  `;
}

describe('historical dynamic sample upgrade', () => {
  let sql: Sql | null = null;
  let beforeCreators: TextRow[] = [];
  let beforeDynamics: TextRow[] = [];
  let beforeSamples: TextRow[] = [];

  beforeAll(async () => {
    const db = await createRetainedDatabase('wp_r2_16b_hist');
    sql = db.sql;
    await applyMigrationsBefore(sql, '011');
    await seedHistory(sql);
    beforeCreators = await snapshotRows(sql, 'creators', 'mid');
    beforeDynamics = await snapshotRows(sql, 'dynamics', 'dynamic_id');
    beforeSamples = await snapshotRows(sql, 'dynamic_metric_samples', 'id');
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('keeps every historical field and labels old rows as import', async () => {
    if (!sql) throw new Error('history database missing');
    const db = sql;
    expect(beforeSamples.length).toBe(3);
    expect(Object.keys(beforeSamples[0] ?? {})).not.toContain('source');

    const applied = await runMigrations(db);
    expect(applied).toEqual([
      '011_dynamic_sample_storage',
      '012_dynamic_monitor_targets',
      '013_monitor_target_start_at',
      '014_video_pinned_at',
    ]);
    const creators = await snapshotRows(db, 'creators', 'mid');
    const dynamics = await snapshotRows(db, 'dynamics', 'dynamic_id');
    const samples = await snapshotRows(db, 'dynamic_metric_samples', 'id');
    const creatorFields = Object.keys(beforeCreators[0] ?? {});
    const dynamicFields = Object.keys(beforeDynamics[0] ?? {});
    const sampleFields = Object.keys(beforeSamples[0] ?? {});
    expect(creatorFields.length).toBeGreaterThan(0);
    expectSameFields(beforeCreators, creators, creatorFields);
    expectSameFields(beforeDynamics, dynamics, dynamicFields);
    expectSameFields(beforeSamples, samples, sampleFields);

    const historicalCreator = creators.find((row) => row.mid === HISTORY_MID);
    const maxCreator = creators.find((row) => row.mid === HISTORY_MID_MAX);
    expect(historicalCreator?.uname).toBe('历史作者');
    expect(historicalCreator?.category).toBe('历史分类');
    expect(historicalCreator?.monitoring_enabled).toBe('false');
    expect(historicalCreator?.deleted_at).toBeNull();
    expect(historicalCreator?.archived_at).not.toBeNull();
    expect(historicalCreator?.face_url).toBe('https://history.example/face.png');
    expect(historicalCreator?.face_asset_id).toBe('asset-hist');
    expect(historicalCreator?.metadata_state).toBe('ok');
    expect(historicalCreator?.metadata_source).toBe('manual');
    expect(historicalCreator?.metadata_error).toBe('无');
    expect(maxCreator?.mid).toBe(HISTORY_MID_MAX);
    expect(maxCreator?.uname).toBeNull();
    expect(maxCreator?.category).toBeNull();
    expect(maxCreator?.monitoring_enabled).toBe('false');
    expect(maxCreator?.metadata_state).toBe('failed');

    const dynamicA = dynamics.find((row) => row.dynamic_id === HISTORY_DYNAMIC);
    const dynamicB = dynamics.find((row) => row.dynamic_id === HISTORY_DYNAMIC_B);
    expect(dynamicA?.dynamic_id).toBe(HISTORY_DYNAMIC);
    expect(dynamicA?.dynamic_id).not.toBe(String(Number(HISTORY_DYNAMIC)));
    expect(dynamicA?.mid).toBe(HISTORY_MID);
    expect(dynamicA?.category).toBe('动态分类');
    expect(dynamicA?.monitoring_enabled).toBe('false');
    expect(dynamicA?.archived_at).not.toBeNull();
    expect(dynamicA?.deleted_at).not.toBeNull();
    expect(dynamicB?.mid).toBeNull();
    expect(dynamicB?.category).toBeNull();
    expect(dynamicB?.monitoring_enabled).toBe('true');
    expect(dynamicB?.archived_at).toBeNull();
    expect(dynamicB?.deleted_at).toBeNull();
    expect(dynamicB?.dynamic_id).toBe(HISTORY_DYNAMIC_B);

    for (const row of samples) {
      expect(row.source).toBe('import');
      expect(row.account_id).toBeNull();
      expect(row.collector_run_id).toBeNull();
      expect(row.collected_at).toBeNull();
      expect(row.extra).toBe('{}');
    }
    const may = samples.find((row) => row.raw_time === '2024-05-01 08:00');
    const june = samples.find((row) => row.raw_time === '2024-06-01 08:00:01');
    const july = samples.find((row) => row.raw_time === '2024-07-01 08:00:00');
    expect(may?.dynamic_id).toBe(HISTORY_DYNAMIC);
    expect(may?.like_count).toBe('0');
    expect(may?.repost_count).toBeNull();
    expect(may?.comment_count).toBe('0');
    expect(may?.import_batch_id).toBe(HISTORY_BATCH);
    expect(may?.source_file_id).not.toBeNull();
    expect(may?.timestamp_precision).toBe('minute');
    expect(june?.like_count).toBeNull();
    expect(june?.repost_count).toBe('0');
    expect(june?.comment_count).toBeNull();
    expect(june?.import_batch_id).toBeNull();
    expect(june?.source_file_id).toBeNull();
    expect(june?.timestamp_precision).toBe('second');
    expect(july?.dynamic_id).toBe(HISTORY_DYNAMIC_B);
    expect(july?.like_count).toBe('0');
    expect(july?.repost_count).toBe('0');
    expect(july?.comment_count).toBe('0');

    const [meta] = await db<{ kept: string | null; n: string | null; text: string | null }[]>`
      SELECT metadata->>'custom' AS kept, metadata->>'n' AS n, metadata->>'text' AS text
      FROM dynamics
      WHERE dynamic_id = ${HISTORY_DYNAMIC}
    `;
    expect(meta?.kept).toBe('stay');
    expect(meta?.n).toBe('0');
    expect(meta?.text).toBe('旧正文');
    const [creatorMeta] = await db<{ kept: string | null; n: string | null }[]>`
      SELECT metadata->>'kept' AS kept, metadata->>'n' AS n
      FROM creators
      WHERE mid = ${HISTORY_MID}::bigint
    `;
    expect(creatorMeta?.kept).toBe('yes');
    expect(creatorMeta?.n).toBe('0');

    const listed = await db<
      { like_count: string | null; repost_count: string | null; comment_count: string | null }[]
    >`
      SELECT m.like_count::text AS like_count,
             m.repost_count::text AS repost_count,
             m.comment_count::text AS comment_count
      FROM dynamics d
      LEFT JOIN LATERAL (
        SELECT like_count, repost_count, comment_count
        FROM dynamic_metric_samples s
        WHERE s.dynamic_id = d.dynamic_id
        ORDER BY sampled_at DESC
        LIMIT 1
      ) m ON TRUE
      WHERE d.dynamic_id = ${HISTORY_DYNAMIC}
    `;
    const latest = listed[0];
    if (!latest) throw new Error('历史列表没有读回');
    expect(latest.like_count).toBeNull();
    expect(latest.repost_count).toBe('0');
    expect(latest.comment_count).toBeNull();

    const series = await db<{ like_count: string | null; repost_count: string | null }[]>`
      SELECT like_count::text AS like_count, repost_count::text AS repost_count
      FROM (
        SELECT sampled_at, like_count, repost_count
        FROM dynamic_metric_samples
        WHERE dynamic_id = ${HISTORY_DYNAMIC}
        ORDER BY sampled_at DESC
        LIMIT 50
      ) recent
      ORDER BY sampled_at ASC
    `;
    expect(series.map((row) => [row.like_count, row.repost_count])).toEqual([
      ['0', null],
      [null, '0'],
    ]);

    const again = await runMigrations(db);
    expect(again).toEqual([]);
    expectSameFields(
      creators,
      await snapshotRows(db, 'creators', 'mid'),
      Object.keys(creators[0] ?? {}),
    );
    expectSameFields(
      dynamics,
      await snapshotRows(db, 'dynamics', 'dynamic_id'),
      Object.keys(dynamics[0] ?? {}),
    );
    expectSameFields(
      samples,
      await snapshotRows(db, 'dynamic_metric_samples', 'id'),
      Object.keys(samples[0] ?? {}),
    );

    const liveId = '8512345678901999001';
    const inserted = await writeDynamicSample(
      db,
      sampleInput({
        dynamicId: liveId,
        authorMid: null,
        authorName: null,
        text: '迁移后样本',
        likeCount: 4n,
        repostCount: 0n,
        commentCount: null,
        source: 'bilibili',
        collectedAt: new Date('2026-08-01T00:00:09.000Z'),
        sampledAt: new Date('2026-08-01T00:00:00.000Z'),
        extra: { marker: 'after-migration' },
      }),
    );
    expect(inserted).toBe(true);
    const withLive = await snapshotRows(db, 'dynamic_metric_samples', 'id');
    const migrationSql = readFileSync(
      join(migrationsDir, '011_dynamic_sample_storage.sql'),
      'utf8',
    );
    await db.unsafe(migrationSql);
    const reapplied = await snapshotRows(db, 'dynamic_metric_samples', 'id');
    expectSameFields(withLive, reapplied, Object.keys(withLive[0] ?? {}));
    expect(
      reapplied
        .filter((row) => row.dynamic_id === HISTORY_DYNAMIC)
        .every((row) => row.source === 'import'),
    ).toBe(true);
    const live = reapplied.find((row) => row.dynamic_id === liveId);
    expect(live?.source).toBe('bilibili');
    expect(live?.like_count).toBe('4');
    expect(live?.repost_count).toBe('0');
    expect(live?.comment_count).toBeNull();
    expect(live?.collected_at).not.toBeNull();
    expect(live?.account_id).toBeNull();
    expect(live?.collector_run_id).toBeNull();
    expect(await runMigrations(db)).toEqual([]);
  }, 60_000);
});

describe('dynamic sample writes', () => {
  let sql: Sql | null = null;
  let databaseName = '';

  beforeAll(async () => {
    const db = await createRetainedDatabase('wp_r2_16b_write');
    sql = db.sql;
    databaseName = db.databaseName;
    const applied = await runMigrations(sql);
    expect(applied.some((version) => version === '011_dynamic_sample_storage')).toBe(true);
    expect(await runMigrations(sql)).toEqual([]);
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  function db(): Sql {
    if (!sql) throw new Error('write database missing');
    return sql;
  }

  test('stores explicit provenance, zero, null, and object JSON', async () => {
    const database = db();
    const chain = await insertCollectorChain(database, 'BV1a2b3c4d5e');
    const dynamicId = '922337203685477580812345';
    const input = sampleInput({
      dynamicId,
      authorMid: '9223372036854775807',
      authorName: '边界作者',
      likeCount: 0n,
      repostCount: 9223372036854775807n,
      commentCount: null,
      source: 'bilibili',
      accountId: chain.accountId,
      collectorRunId: chain.runId,
      collectedAt: new Date('2026-04-01T00:00:05.000Z'),
      sampledAt: new Date('2026-04-01T00:00:00.000Z'),
      extra: { marker: 'live', zero: 0, clip: { id: '1' } },
      visible: false,
    });
    expect(await writeDynamicSample(database, input)).toBe(true);
    const [row] = await database<
      {
        dynamic_id: string;
        like_count: string | null;
        repost_count: string | null;
        comment_count: string | null;
        source: string;
        account_id: string | null;
        collector_run_id: string | null;
        sampled_at: Date;
        collected_at: Date | null;
        extra_type: string;
        marker: string | null;
        zero: string | null;
        clip_id: string | null;
        meta_type: string;
        visible_type: string | null;
        text: string | null;
        published_at: string | null;
        author_face: string | null;
        monitoring_enabled: boolean;
        category: string | null;
        mid: string | null;
        uname: string | null;
      }[]
    >`
      SELECT s.dynamic_id,
             s.like_count::text AS like_count,
             s.repost_count::text AS repost_count,
             s.comment_count::text AS comment_count,
             s.source,
             s.account_id::text AS account_id,
             s.collector_run_id::text AS collector_run_id,
             s.sampled_at,
             s.collected_at,
             jsonb_typeof(s.extra) AS extra_type,
             s.extra->>'marker' AS marker,
             s.extra->>'zero' AS zero,
             s.extra->'clip'->>'id' AS clip_id,
             jsonb_typeof(d.metadata) AS meta_type,
             jsonb_typeof(d.metadata->'visible') AS visible_type,
             d.metadata->>'text' AS text,
             d.metadata->>'published_at' AS published_at,
             d.metadata->>'author_face' AS author_face,
             d.monitoring_enabled,
             d.category,
             d.mid::text AS mid,
             c.uname
      FROM dynamic_metric_samples s
      JOIN dynamics d ON d.dynamic_id = s.dynamic_id
      JOIN creators c ON c.mid = d.mid
      WHERE s.dynamic_id = ${dynamicId}
    `;
    expect(row?.dynamic_id).toBe(dynamicId);
    expect(row?.dynamic_id).not.toBe(String(Number(dynamicId)));
    expect(row?.like_count).toBe('0');
    expect(row?.repost_count).toBe('9223372036854775807');
    expect(row?.comment_count).toBeNull();
    expect(row?.source).toBe('bilibili');
    expect(row?.account_id).toBe(chain.accountId);
    expect(row?.collector_run_id).toBe(chain.runId);
    expect(row?.sampled_at.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(row?.collected_at?.toISOString()).toBe('2026-04-01T00:00:05.000Z');
    expect(row?.extra_type).toBe('object');
    expect(row?.marker).toBe('live');
    expect(row?.zero).toBe('0');
    expect(row?.clip_id).toBe('1');
    expect(row?.meta_type).toBe('object');
    expect(row?.visible_type).toBe('boolean');
    expect(row?.text).toBe('正文甲');
    expect(row?.published_at).toBe('2024-08-20T11:17:00.000Z');
    expect(row?.author_face).toBe('https://example.test/face.jpg');
    expect(row?.monitoring_enabled).toBe(true);
    expect(row?.category).toBeNull();
    expect(row?.mid).toBe('9223372036854775807');
    expect(row?.uname).toBe('边界作者');

    const sameInstant = new Date('2026-04-01T08:00:00.000+08:00');
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          ...input,
          rawTime: '另一条原文',
          collectedAt: new Date('2026-04-02T00:00:00.000Z'),
          likeCount: 9n,
          source: 'import',
          sampledAt: sameInstant,
        }),
      ),
    ).toBe(false);
    const [unchanged] = await database<{ like_count: string; raw_time: string; source: string }[]>`
      SELECT like_count::text AS like_count, raw_time, source
      FROM dynamic_metric_samples
      WHERE dynamic_id = ${dynamicId}
    `;
    expect(unchanged?.like_count).toBe('0');
    expect(unchanged?.raw_time).toBe('2026-04-01 08:00:00');
    expect(unchanged?.source).toBe('bilibili');

    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          ...input,
          sampledAt: new Date('2026-04-01T00:00:01.000Z'),
          collectedAt: input.collectedAt,
          likeCount: 2n,
          repostCount: 0n,
          commentCount: 0n,
        }),
      ),
    ).toBe(true);
    const buckets = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}
    `;
    expect(buckets[0]?.n).toBe('2');
  });

  test('keeps the import column list and does not overwrite import or legacy rows', async () => {
    const database = db();
    const dynamicId = '999001';
    const batchId = '16b22222-2222-4222-8222-222222222222';
    await database`
      INSERT INTO import_batches (id, mode, source_timezone)
      VALUES (${batchId}::uuid, 'apply', 'Asia/Shanghai')
    `;
    const [file] = await database<{ id: string }[]>`
      INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
      VALUES (
        ${batchId}::uuid, '999_detailcount.csv', 'importsha', 'canonical', 'detailcount', ${dynamicId}, 1
      )
      RETURNING id::text AS id
    `;
    if (!file) throw new Error('导入来源文件没有写入');
    await database`INSERT INTO dynamics (dynamic_id) VALUES (${dynamicId})`;
    await database`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
        like_count, repost_count, comment_count, import_batch_id, source_file_id
      ) VALUES (
        ${dynamicId},
        '2025-03-01T00:00:01Z',
        'Asia/Shanghai',
        '2025-03-01 08:00:01',
        'second',
        0,
        NULL,
        0,
        ${batchId}::uuid,
        ${file.id}::bigint
      )
    `;
    const [imported] = await database<
      {
        source: string;
        account_id: string | null;
        collector_run_id: string | null;
        collected_at: Date | null;
        extra: string;
        like_count: string | null;
        repost_count: string | null;
        comment_count: string | null;
        import_batch_id: string | null;
      }[]
    >`
      SELECT source, account_id::text AS account_id, collector_run_id::text AS collector_run_id,
             collected_at, extra::text AS extra, like_count::text AS like_count,
             repost_count::text AS repost_count, comment_count::text AS comment_count,
             import_batch_id::text AS import_batch_id
      FROM dynamic_metric_samples
      WHERE dynamic_id = ${dynamicId}
    `;
    expect(imported?.source).toBe('import');
    expect(imported?.account_id).toBeNull();
    expect(imported?.collector_run_id).toBeNull();
    expect(imported?.collected_at).toBeNull();
    expect(imported?.extra).toBe('{}');
    expect(imported?.like_count).toBe('0');
    expect(imported?.repost_count).toBeNull();
    expect(imported?.comment_count).toBe('0');
    expect(imported?.import_batch_id).toBe(batchId);

    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId,
          sampledAt: new Date('2025-03-01T00:00:01.000Z'),
          likeCount: 8n,
          repostCount: 8n,
          commentCount: 8n,
          source: 'bilibili',
          authorMid: null,
          authorName: null,
          text: null,
        }),
      ),
    ).toBe(false);
    const [afterImport] = await database<
      { like_count: string | null; source: string; text: string | null }[]
    >`
      SELECT s.like_count::text AS like_count, s.source, d.metadata->>'text' AS text
      FROM dynamic_metric_samples s
      JOIN dynamics d ON d.dynamic_id = s.dynamic_id
      WHERE s.dynamic_id = ${dynamicId}
    `;
    expect(afterImport?.like_count).toBe('0');
    expect(afterImport?.source).toBe('import');
    expect(afterImport?.text ?? null).toBeNull();

    const legacyId = '999002';
    await database`INSERT INTO dynamics (dynamic_id, metadata) VALUES (${legacyId}, '{"text":"遗留"}'::jsonb)`;
    await database`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
        like_count, repost_count, comment_count, source, extra
      ) VALUES (
        ${legacyId}, '2025-04-01T00:00:00Z', 'Asia/Shanghai', '2025-04-01 08:00', 'minute',
        7, NULL, NULL, 'legacy_csv', '{"from":"legacy"}'::jsonb
      )
    `;
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: legacyId,
          sampledAt: new Date('2025-04-01T00:00:00.000Z'),
          likeCount: 1n,
          source: 'bilibili',
          text: '新正文',
          authorMid: null,
        }),
      ),
    ).toBe(false);
    const [legacy] = await database<
      { source: string; like_count: string; from: string | null; text: string | null }[]
    >`
      SELECT s.source, s.like_count::text AS like_count, s.extra->>'from' AS from, d.metadata->>'text' AS text
      FROM dynamic_metric_samples s
      JOIN dynamics d ON d.dynamic_id = s.dynamic_id
      WHERE s.dynamic_id = ${legacyId}
    `;
    expect(legacy?.source).toBe('legacy_csv');
    expect(legacy?.like_count).toBe('7');
    expect(legacy?.from).toBe('legacy');
    expect(legacy?.text).toBe('遗留');

    const duplicate = await database`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision, like_count, source
      ) VALUES (
        ${legacyId}, '2025-04-01T00:00:00Z', 'Asia/Shanghai', 'x', 'minute', 1, 'bilibili'
      )
    `.catch((error: unknown) => error);
    expect(duplicate).toBeInstanceOf(Error);
    expect((duplicate as { code?: string }).code).toBe('23505');
    const [stillLegacy] = await database<{ n: string; like_count: string }[]>`
      SELECT count(*)::text AS n, max(like_count)::text AS like_count
      FROM dynamic_metric_samples
      WHERE dynamic_id = ${legacyId}
    `;
    expect(stillLegacy?.n).toBe('1');
    expect(stillLegacy?.like_count).toBe('7');

    const rejected = await database`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision, source
      ) VALUES (
        ${legacyId}, '2025-04-02T00:00:00Z', 'Asia/Shanghai', 'x', 'minute', 'live'
      )
    `.catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    const [legacyCount] = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM dynamic_metric_samples WHERE dynamic_id = ${legacyId}
    `;
    expect(legacyCount?.n).toBe('1');
  });

  test('preserves business flags, unknown metadata, and missing fields', async () => {
    const database = db();
    const dynamicId = '8510000000000003333';
    const mid = '35100003333';
    await database`
      INSERT INTO creators (
        mid, uname, category, monitoring_enabled, archived_at, deleted_at, metadata,
        face_url, face_asset_id, updated_at
      ) VALUES (
        ${mid}::bigint,
        '旧作者',
        '作者分类',
        false,
        '2023-01-01T00:00:00Z',
        '2023-02-01T00:00:00Z',
        '{"creator_note":"keep"}'::jsonb,
        'https://old.example/face.png',
        'asset-old',
        '2020-01-01T00:00:00Z'
      )
    `;
    await database`
      INSERT INTO dynamics (
        dynamic_id, mid, category, monitoring_enabled, archived_at, deleted_at, metadata, updated_at
      ) VALUES (
        ${dynamicId},
        ${mid}::bigint,
        '动态分类',
        false,
        '2023-03-01T00:00:00Z',
        '2023-04-01T00:00:00Z',
        '{"custom":"stay","text":"旧正文","visible":true,"author_name":"旧作者"}'::jsonb,
        '2020-01-01T00:00:00Z'
      )
    `;
    const wide = {
      ...sampleInput({
        dynamicId,
        authorMid: mid,
        authorName: '新作者',
        text: '新正文',
        visible: false,
        faceUrl: 'https://new.example/face.jpg',
        likeCount: 3n,
        repostCount: 0n,
        commentCount: null,
        sampledAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
      unexpected: null,
      category: '被改写',
    };
    expect(await writeDynamicSample(database, wide)).toBe(true);
    const [row] = await database<
      {
        category: string | null;
        monitoring_enabled: boolean;
        archived_at: Date | null;
        deleted_at: Date | null;
        custom: string | null;
        text: string | null;
        visible: string | null;
        author_name: string | null;
        author_face: string | null;
        has_category_key: boolean;
        uname: string | null;
        creator_category: string | null;
        creator_enabled: boolean;
        creator_note: string | null;
        face_url: string | null;
        face_asset_id: string | null;
        meta_type: string;
      }[]
    >`
      SELECT d.category, d.monitoring_enabled, d.archived_at, d.deleted_at,
             d.metadata->>'custom' AS custom,
             d.metadata->>'text' AS text,
             d.metadata->>'visible' AS visible,
             d.metadata->>'author_name' AS author_name,
             d.metadata->>'author_face' AS author_face,
             (d.metadata ? 'category') AS has_category_key,
             jsonb_typeof(d.metadata) AS meta_type,
             c.uname, c.category AS creator_category, c.monitoring_enabled AS creator_enabled,
             c.metadata->>'creator_note' AS creator_note,
             c.face_url, c.face_asset_id
      FROM dynamics d
      JOIN creators c ON c.mid = d.mid
      WHERE d.dynamic_id = ${dynamicId}
    `;
    expect(row?.category).toBe('动态分类');
    expect(row?.monitoring_enabled).toBe(false);
    expect(row?.archived_at?.toISOString()).toBe('2023-03-01T00:00:00.000Z');
    expect(row?.deleted_at?.toISOString()).toBe('2023-04-01T00:00:00.000Z');
    expect(row?.custom).toBe('stay');
    expect(row?.text).toBe('新正文');
    expect(row?.visible).toBe('false');
    expect(row?.author_name).toBe('新作者');
    expect(row?.author_face).toBe('https://new.example/face.jpg');
    expect(row?.has_category_key).toBe(false);
    expect(row?.meta_type).toBe('object');
    expect(row?.uname).toBe('新作者');
    expect(row?.creator_category).toBe('作者分类');
    expect(row?.creator_enabled).toBe(false);
    expect(row?.creator_note).toBe('keep');
    expect(row?.face_url).toBe('https://old.example/face.png');
    expect(row?.face_asset_id).toBe('asset-old');

    await database`
      UPDATE dynamics SET updated_at = '2020-01-01T00:00:00Z' WHERE dynamic_id = ${dynamicId}
    `;
    await database`UPDATE creators SET updated_at = '2020-01-01T00:00:00Z' WHERE mid = ${mid}::bigint`;
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId,
          authorMid: null,
          authorName: null,
          text: null,
          visible: null,
          faceUrl: null,
          publishedAt: null,
          publishedText: '   ',
          dynamicType: null,
          majorType: null,
          likeCount: null,
          repostCount: null,
          commentCount: null,
          sampledAt: new Date('2026-05-02T00:00:00.000Z'),
          source: 'import',
          collectedAt: null,
          extra: {},
        }),
      ),
    ).toBe(true);
    const [kept] = await database<
      {
        text: string | null;
        visible: string | null;
        author_name: string | null;
        mid: string | null;
        uname: string | null;
        dynamic_updated: Date;
        creator_updated: Date;
        like_count: string | null;
      }[]
    >`
      SELECT d.metadata->>'text' AS text,
             d.metadata->>'visible' AS visible,
             d.metadata->>'author_name' AS author_name,
             d.mid::text AS mid,
             c.uname,
             d.updated_at AS dynamic_updated,
             c.updated_at AS creator_updated,
             s.like_count::text AS like_count
      FROM dynamics d
      JOIN creators c ON c.mid = d.mid
      JOIN dynamic_metric_samples s ON s.dynamic_id = d.dynamic_id
      WHERE d.dynamic_id = ${dynamicId} AND s.sampled_at = '2026-05-02T00:00:00Z'
    `;
    expect(kept?.text).toBe('新正文');
    expect(kept?.visible).toBe('false');
    expect(kept?.author_name).toBe('新作者');
    expect(kept?.mid).toBe(mid);
    expect(kept?.uname).toBe('新作者');
    expect(kept?.like_count).toBeNull();
    expect(kept?.dynamic_updated.toISOString()).not.toBe('2020-01-01T00:00:00.000Z');
    expect(kept?.creator_updated.toISOString()).toBe('2020-01-01T00:00:00.000Z');

    await database`UPDATE dynamics SET updated_at = '2020-01-01T00:00:00Z' WHERE dynamic_id = ${dynamicId}`;
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId,
          sampledAt: new Date('2026-05-01T00:00:00.000Z'),
          likeCount: 99n,
          text: '冲突正文',
          authorName: '冲突作者',
          authorMid: mid,
        }),
      ),
    ).toBe(false);
    const [conflict] = await database<
      { text: string | null; updated_at: Date; like_count: string }[]
    >`
      SELECT d.metadata->>'text' AS text, d.updated_at, s.like_count::text AS like_count
      FROM dynamics d
      JOIN dynamic_metric_samples s ON s.dynamic_id = d.dynamic_id
      WHERE d.dynamic_id = ${dynamicId} AND s.sampled_at = '2026-05-01T00:00:00Z'
    `;
    expect(conflict?.text).toBe('新正文');
    expect(conflict?.like_count).toBe('3');
    expect(conflict?.updated_at.toISOString()).toBe('2020-01-01T00:00:00.000Z');

    const emptyId = '8510000000000003334';
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: emptyId,
          authorMid: null,
          authorName: null,
          text: null,
          visible: null,
          faceUrl: null,
          publishedAt: null,
          publishedText: null,
          dynamicType: null,
          majorType: null,
          extra: {},
          collectedAt: null,
          source: 'import',
        }),
      ),
    ).toBe(true);
    const [emptyMeta] = await database<{ metadata: string; has_text: boolean }[]>`
      SELECT metadata::text AS metadata, (metadata ? 'text') AS has_text
      FROM dynamics
      WHERE dynamic_id = ${emptyId}
    `;
    expect(emptyMeta?.metadata).toBe('{}');
    expect(emptyMeta?.has_text).toBe(false);
  });

  test('rejects invalid ids, counts, and times without leaving rows', async () => {
    const database = db();
    const anchorId = '8510000000000004440';
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: anchorId,
          authorMid: '35100004440',
          authorName: '锚点',
          likeCount: 1n,
          text: '锚点正文',
        }),
      ),
    ).toBe(true);
    const cases: { input: DynamicSampleWrite; pattern: RegExp }[] = [
      { input: sampleInput({ dynamicId: '0' }), pattern: /动态 id/ },
      { input: sampleInput({ dynamicId: '01' }), pattern: /动态 id/ },
      { input: sampleInput({ dynamicId: '12.5' }), pattern: /动态 id/ },
      { input: sampleInput({ dynamicId: '-1' }), pattern: /动态 id/ },
      { input: sampleInput({ dynamicId: 12 as unknown as string }), pattern: /动态 id/ },
      { input: sampleInput({ authorMid: '-1' }), pattern: /作者 mid/ },
      { input: sampleInput({ authorMid: '9223372036854775808' }), pattern: /作者 mid/ },
      { input: sampleInput({ authorMid: '01' }), pattern: /作者 mid/ },
      { input: sampleInput({ likeCount: -1n }), pattern: /like_count/ },
      { input: sampleInput({ repostCount: -1n }), pattern: /repost_count/ },
      { input: sampleInput({ commentCount: 9223372036854775808n }), pattern: /comment_count/ },
      {
        input: sampleInput({ likeCount: 1 as unknown as bigint }),
        pattern: /like_count/,
      },
      { input: sampleInput({ sampledAt: new Date('not-a-date') }), pattern: /采样时间/ },
      { input: sampleInput({ collectedAt: new Date(Number.NaN) }), pattern: /collected_at/ },
      { input: sampleInput({ publishedAt: new Date('nope') }), pattern: /发布时间/ },
      {
        input: sampleInput({ source: 'live' as DynamicSampleWrite['source'] }),
        pattern: /source/,
      },
      { input: sampleInput({ accountId: 'not-a-uuid' }), pattern: /account_id/ },
      {
        input: sampleInput({ extra: ['nope'] as unknown as Record<string, unknown> }),
        pattern: /extra/,
      },
      { input: sampleInput({ extra: { n: 1n } }), pattern: /extra/ },
      {
        input: sampleInput({ timestampPrecision: 'hour' as 'minute' }),
        pattern: /timestamp_precision/,
      },
    ];
    for (const item of cases) {
      const error = await writeDynamicSample(database, item.input).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(item.pattern);
    }
    const anchorError = await writeDynamicSample(
      database,
      sampleInput({ dynamicId: anchorId, likeCount: -5n, text: '坏正文' }),
    ).catch((caught: unknown) => caught);
    expect(anchorError).toBeInstanceOf(Error);
    const [anchor] = await database<{ text: string | null; like_count: string }[]>`
      SELECT d.metadata->>'text' AS text, s.like_count::text AS like_count
      FROM dynamics d
      JOIN dynamic_metric_samples s ON s.dynamic_id = d.dynamic_id
      WHERE d.dynamic_id = ${anchorId}
    `;
    expect(anchor?.text).toBe('锚点正文');
    expect(anchor?.like_count).toBe('1');
    const stray = await database<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM dynamics
      WHERE dynamic_id IN ('0', '01', '12.5', '8510000000000000001')
    `;
    expect(stray[0]?.n).toBe('0');
    const defaultAuthor = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM creators WHERE mid = ${'35100000011'}::bigint
    `;
    expect(defaultAuthor[0]?.n).toBe('0');
    const strayCreator = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM creators WHERE mid::text IN ('9223372036854775808', '01')
    `;
    expect(strayCreator[0]?.n).toBe('0');
  });

  test('rolls back the author, dynamic, and sample together', async () => {
    const database = db();
    const dynamicId = '8510000000000005555';
    const mid = '35100005555';
    const existingId = '8510000000000005556';
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: existingId,
          authorMid: '35100005556',
          text: '已提交',
          likeCount: 2n,
          sampledAt: new Date('2026-06-01T00:00:00.000Z'),
        }),
      ),
    ).toBe(true);
    await database`
      UPDATE dynamics SET updated_at = '2020-06-01T00:00:00Z', metadata = metadata || '{"custom":"keep"}'::jsonb
      WHERE dynamic_id = ${existingId}
    `;
    const error = await database
      .begin(async (tx) => {
        const inserted = await writeDynamicSampleWithin(
          tx,
          sampleInput({
            dynamicId,
            authorMid: mid,
            authorName: '应回滚',
            text: '应回滚正文',
            likeCount: 6n,
          }),
        );
        if (!inserted) throw new Error('应当插入');
        const followed = await writeDynamicSampleWithin(
          tx,
          sampleInput({
            dynamicId: existingId,
            authorMid: '35100005556',
            text: '不应留下',
            likeCount: 9n,
            sampledAt: new Date('2026-06-02T00:00:00.000Z'),
          }),
        );
        if (!followed) throw new Error('应当插入第二桶');
        throw new Error('rollback-marker');
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('rollback-marker');
    const created = await database<{ n: string }[]>`
      SELECT (
        (SELECT count(*) FROM dynamics WHERE dynamic_id = ${dynamicId})
        + (SELECT count(*) FROM creators WHERE mid = ${mid}::bigint)
        + (SELECT count(*) FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId})
      )::text AS n
    `;
    expect(created[0]?.n).toBe('0');
    const [existing] = await database<
      { text: string | null; custom: string | null; n: string; like_count: string }[]
    >`
      SELECT d.metadata->>'text' AS text, d.metadata->>'custom' AS custom,
             (SELECT count(*)::text FROM dynamic_metric_samples WHERE dynamic_id = ${existingId}) AS n,
             s.like_count::text AS like_count
      FROM dynamics d
      JOIN dynamic_metric_samples s ON s.dynamic_id = d.dynamic_id
      WHERE d.dynamic_id = ${existingId}
    `;
    expect(existing?.text).toBe('已提交');
    expect(existing?.custom).toBe('keep');
    expect(existing?.n).toBe('1');
    expect(existing?.like_count).toBe('2');

    const missingAccount = '16b00000-0000-4000-8000-000000000099';
    const fkId = '8510000000000005557';
    const fkMid = '35100005557';
    const fkError = await writeDynamicSample(
      database,
      sampleInput({ dynamicId: fkId, authorMid: fkMid, accountId: missingAccount }),
    ).catch((caught: unknown) => caught);
    expect(fkError).toBeInstanceOf(Error);
    const fkRows = await database<{ n: string }[]>`
      SELECT (
        (SELECT count(*) FROM dynamics WHERE dynamic_id = ${fkId})
        + (SELECT count(*) FROM creators WHERE mid = ${fkMid}::bigint)
        + (SELECT count(*) FROM dynamic_metric_samples WHERE dynamic_id = ${fkId})
      )::text AS n
    `;
    expect(fkRows[0]?.n).toBe('0');
  });

  test('follows video and creator foreign-key delete rules on its own fixtures', async () => {
    const database = db();
    const defs = await database<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.dynamic_metric_samples'::regclass AND contype = 'f'
    `;
    const texts = defs.map((row) => row.def);
    expect(
      texts.some((def) => def.includes('account_id') && def.includes('ON DELETE SET NULL')),
    ).toBe(true);
    expect(
      texts.some((def) => def.includes('collector_run_id') && def.includes('ON DELETE SET NULL')),
    ).toBe(true);
    const dynamicFk = texts.find((def) => def.includes('dynamic_id') && def.includes('dynamics'));
    expect(dynamicFk).toBeDefined();
    expect(dynamicFk?.includes('ON DELETE CASCADE')).toBe(false);
    expect(dynamicFk?.includes('ON DELETE SET NULL')).toBe(false);

    const accountChain = await insertCollectorChain(database, 'BV1a2b3c4d5f');
    const controlChain = await insertCollectorChain(database, 'BV1a2b3c4d5g');
    const accountDynamic = '8510000000000006661';
    const controlDynamic = '8510000000000006662';
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: accountDynamic,
          authorMid: null,
          accountId: accountChain.accountId,
          collectorRunId: accountChain.runId,
          likeCount: 4n,
          sampledAt: new Date('2026-07-01T00:00:00.000Z'),
          extra: { marker: 'account-parent' },
        }),
      ),
    ).toBe(true);
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: controlDynamic,
          authorMid: null,
          accountId: controlChain.accountId,
          collectorRunId: controlChain.runId,
          likeCount: 5n,
          sampledAt: new Date('2026-07-01T00:00:00.000Z'),
          extra: { marker: 'control' },
        }),
      ),
    ).toBe(true);
    const beforeDelete = await readSample(database, accountDynamic);
    await database`DELETE FROM bili_accounts WHERE id = ${accountChain.accountId}::uuid`;
    const afterAccount = await readSample(database, accountDynamic);
    const control = await readSample(database, controlDynamic);
    expect(afterAccount.account_id).toBeNull();
    expect(afterAccount.collector_run_id).toBe(accountChain.runId);
    expect(afterAccount.like_count).toBe(beforeDelete.like_count);
    expect(afterAccount.source).toBe(beforeDelete.source);
    expect(afterAccount.dynamic_id).toBe(accountDynamic);
    expect(afterAccount.id).toBe(beforeDelete.id);
    expect(afterAccount.marker).toBe('account-parent');
    expect(control.account_id).toBe(controlChain.accountId);
    expect(control.like_count).toBe('5');
    expect(control.marker).toBe('control');

    const runChain = await insertCollectorChain(database, 'BV1a2b3c4d5h');
    const runDynamic = '8510000000000006663';
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: runDynamic,
          authorMid: null,
          accountId: runChain.accountId,
          collectorRunId: runChain.runId,
          likeCount: 6n,
          sampledAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      ),
    ).toBe(true);
    await database`DELETE FROM collector_runs WHERE id = ${runChain.runId}::uuid`;
    const afterRun = await readSample(database, runDynamic);
    expect(afterRun.collector_run_id).toBeNull();
    expect(afterRun.account_id).toBe(runChain.accountId);
    expect(afterRun.like_count).toBe('6');
    expect(afterRun.dynamic_id).toBe(runDynamic);
    const controlStill = await readSample(database, controlDynamic);
    expect(controlStill.collector_run_id).toBe(controlChain.runId);

    const blockedMid = '35100006664';
    const blockedDynamic = '8510000000000006664';
    await database`
      INSERT INTO creators (mid, uname, category, monitoring_enabled)
      VALUES (${blockedMid}::bigint, '不可删', '保留', false)
    `;
    expect(
      await writeDynamicSample(
        database,
        sampleInput({
          dynamicId: blockedDynamic,
          authorMid: blockedMid,
          authorName: null,
          likeCount: 1n,
          sampledAt: new Date('2026-07-03T00:00:00.000Z'),
        }),
      ),
    ).toBe(true);
    const blockedDelete = await database
      .begin(async (tx) => {
        await tx`DELETE FROM creators WHERE mid = ${blockedMid}::bigint`;
        await tx`DELETE FROM dynamic_metric_samples WHERE dynamic_id = ${controlDynamic}`;
      })
      .catch((caught: unknown) => caught);
    expect(blockedDelete).toBeInstanceOf(Error);
    expect((blockedDelete as { code?: string }).code).toBe('23503');
    const [blocked] = await database<{ uname: string; n: string }[]>`
      SELECT c.uname, (SELECT count(*)::text FROM dynamic_metric_samples WHERE dynamic_id = ${blockedDynamic}) AS n
      FROM creators c
      WHERE c.mid = ${blockedMid}::bigint
    `;
    expect(blocked?.uname).toBe('不可删');
    expect(blocked?.n).toBe('1');
    expect((await readSample(database, controlDynamic)).marker).toBe('control');

    const freeMid = '35100006665';
    await database`INSERT INTO creators (mid, uname) VALUES (${freeMid}::bigint, '可删')`;
    await database`DELETE FROM creators WHERE mid = ${freeMid}::bigint`;
    const freeGone = await database`SELECT mid FROM creators WHERE mid = ${freeMid}::bigint`;
    expect(freeGone).toHaveLength(0);
    const [blockedStill] = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM creators WHERE mid = ${blockedMid}::bigint
    `;
    expect(blockedStill?.n).toBe('1');

    const dynamicDelete =
      await database`DELETE FROM dynamics WHERE dynamic_id = ${blockedDynamic}`.catch(
        (caught: unknown) => caught,
      );
    expect(dynamicDelete).toBeInstanceOf(Error);
    expect((dynamicDelete as { code?: string }).code).toBe('23503');
    expect((await readSample(database, blockedDynamic)).like_count).toBe('1');
    const removable = '8510000000000006666';
    await database`INSERT INTO dynamics (dynamic_id, category) VALUES (${removable}, '临时')`;
    await database`DELETE FROM dynamics WHERE dynamic_id = ${removable}`;
    const removed = await database`SELECT dynamic_id FROM dynamics WHERE dynamic_id = ${removable}`;
    expect(removed).toHaveLength(0);
    const [blockedDynamicStill] = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM dynamics WHERE dynamic_id = ${blockedDynamic}
    `;
    expect(blockedDynamicStill?.n).toBe('1');
  });

  test('concurrent writers leave exactly one sample that matches the inserted result', async () => {
    const database = db();
    const cfg = readDbConfigFromEnv();
    const left = createSql({ ...cfg, database: databaseName });
    const right = createSql({ ...cfg, database: databaseName });
    try {
      const dynamicId = '8510000000000007771';
      const sampledAt = new Date('2026-08-01T00:00:00.000Z');
      const inputA = sampleInput({
        dynamicId,
        authorMid: '35100007771',
        authorName: '并发甲',
        text: '并发甲',
        likeCount: 11n,
        repostCount: 1n,
        commentCount: 0n,
        sampledAt,
        source: 'bilibili',
        extra: { marker: 'A' },
      });
      const inputB = sampleInput({
        ...inputA,
        authorName: '并发乙',
        text: '并发乙',
        likeCount: 22n,
        repostCount: 2n,
        commentCount: null,
        source: 'legacy_csv',
        extra: { marker: 'B' },
      });
      const arrive = gate(2);
      const [resultA, resultB] = await Promise.all([
        left.begin(async (tx) => {
          await arrive();
          return writeDynamicSampleWithin(tx, inputA);
        }),
        right.begin(async (tx) => {
          await arrive();
          return writeDynamicSampleWithin(tx, inputB);
        }),
      ]);
      expect([resultA, resultB].filter(Boolean)).toHaveLength(1);
      const winner = resultA ? inputA : inputB;
      const [row] = await database<
        {
          n: string;
          like_count: string;
          source: string;
          marker: string | null;
          text: string | null;
          uname: string;
        }[]
      >`
        SELECT (SELECT count(*)::text FROM dynamic_metric_samples WHERE dynamic_id = ${dynamicId}) AS n,
               s.like_count::text AS like_count, s.source, s.extra->>'marker' AS marker,
               d.metadata->>'text' AS text, c.uname
        FROM dynamic_metric_samples s
        JOIN dynamics d ON d.dynamic_id = s.dynamic_id
        JOIN creators c ON c.mid = d.mid
        WHERE s.dynamic_id = ${dynamicId}
      `;
      if (winner.authorName == null || winner.text == null || winner.likeCount == null) {
        throw new Error('并发样本缺少可比字段');
      }
      expect(row?.n).toBe('1');
      expect(row?.like_count).toBe(winner.likeCount.toString());
      expect(row?.source).toBe(winner.source);
      expect(row?.marker).toBe((winner.extra as { marker: string }).marker);
      expect(row?.text).toBe(winner.text);
      expect(row?.uname).toBe(winner.authorName);

      const existingId = '8510000000000007772';
      expect(
        await writeDynamicSample(
          database,
          sampleInput({
            dynamicId: existingId,
            authorMid: null,
            text: '已有',
            likeCount: 5n,
            source: 'import',
            collectedAt: null,
            extra: { marker: 'old' },
            sampledAt,
          }),
        ),
      ).toBe(true);
      const again = gate(2);
      const [againA, againB] = await Promise.all([
        left.begin(async (tx) => {
          await again();
          return writeDynamicSampleWithin(
            tx,
            sampleInput({
              dynamicId: existingId,
              sampledAt,
              likeCount: 50n,
              source: 'bilibili',
              text: '冲掉',
              authorMid: null,
              extra: { marker: 'new-a' },
            }),
          );
        }),
        right.begin(async (tx) => {
          await again();
          return writeDynamicSampleWithin(
            tx,
            sampleInput({
              dynamicId: existingId,
              sampledAt,
              likeCount: 60n,
              source: 'legacy_csv',
              text: '冲掉',
              authorMid: null,
              extra: { marker: 'new-b' },
            }),
          );
        }),
      ]);
      expect(againA).toBe(false);
      expect(againB).toBe(false);
      const [kept] = await database<
        {
          n: string;
          like_count: string;
          source: string;
          marker: string | null;
          text: string | null;
        }[]
      >`
        SELECT (SELECT count(*)::text FROM dynamic_metric_samples WHERE dynamic_id = ${existingId}) AS n,
               s.like_count::text AS like_count, s.source, s.extra->>'marker' AS marker,
               d.metadata->>'text' AS text
        FROM dynamic_metric_samples s
        JOIN dynamics d ON d.dynamic_id = s.dynamic_id
        WHERE s.dynamic_id = ${existingId}
      `;
      expect(kept?.n).toBe('1');
      expect(kept?.like_count).toBe('5');
      expect(kept?.source).toBe('import');
      expect(kept?.marker).toBe('old');
      expect(kept?.text).toBe('已有');
    } finally {
      await left.end({ timeout: 5 });
      await right.end({ timeout: 5 });
    }
  }, 30_000);

  test('video and creator sample writers still insert and keep conflicts', async () => {
    const database = db();
    const sampledAt = new Date('2026-02-01T00:00:00.000Z');
    expect(
      await writeVideoSample(database, {
        bvid: 'BV1a2b3c4d5j',
        title: '存储回归',
        sampledAt,
        rawTime: '2026-02-01 08:00',
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: 'minute',
        viewCount: 0n,
        onlineViewers: null,
        onlineViewersRaw: null,
        likeCount: null,
        coinCount: null,
        favoriteCount: null,
        shareCount: null,
        danmakuCount: null,
        commentCount: null,
        source: 'bilibili',
        accountId: null,
        collectorRunId: null,
        collectedAt: new Date('2026-02-01T00:00:02.000Z'),
        extra: { kind: 'video' },
      }),
    ).toBe(true);
    expect(
      await writeVideoSample(database, {
        bvid: 'BV1a2b3c4d5j',
        title: '存储回归',
        sampledAt,
        rawTime: '2026-02-01 08:00',
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: 'minute',
        viewCount: 9n,
        onlineViewers: null,
        onlineViewersRaw: null,
        likeCount: null,
        coinCount: null,
        favoriteCount: null,
        shareCount: null,
        danmakuCount: null,
        commentCount: null,
        source: 'import',
        accountId: null,
        collectorRunId: null,
        collectedAt: null,
        extra: {},
      }),
    ).toBe(false);
    const [video] = await database<{ view_count: string | null; source: string }[]>`
      SELECT view_count::text AS view_count, source
      FROM video_metric_samples
      WHERE bvid = 'BV1a2b3c4d5j'
    `;
    expect(video?.view_count).toBe('0');
    expect(video?.source).toBe('bilibili');

    expect(
      await writeCreatorSample(database, {
        mid: '35100999001',
        uname: '回归作者',
        sampledAt,
        rawTime: '2026-02-01 08:00',
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: 'minute',
        followerCount: 0n,
        followingCount: null,
        source: 'legacy_csv',
        accountId: null,
        collectorRunId: null,
        collectedAt: null,
        extra: {},
      }),
    ).toBe(true);
    expect(
      await writeCreatorSample(database, {
        mid: '35100999001',
        uname: '回归作者',
        sampledAt,
        rawTime: '2026-02-01 08:00',
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: 'minute',
        followerCount: 4n,
        followingCount: 1n,
        source: 'bilibili',
        accountId: null,
        collectorRunId: null,
        collectedAt: new Date('2026-02-01T00:00:03.000Z'),
        extra: { kind: 'creator' },
      }),
    ).toBe(false);
    const [creator] = await database<{ follower_count: string; source: string }[]>`
      SELECT follower_count::text AS follower_count, source
      FROM creator_follower_samples
      WHERE mid = ${'35100999001'}::bigint
    `;
    expect(creator?.follower_count).toBe('0');
    expect(creator?.source).toBe('legacy_csv');
  });

  test('allows a fixed dynamic target and still rejects automatic mode', async () => {
    const database = db();
    const checks = await database<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.monitor_targets'::regclass AND contype = 'c'
    `;
    const defs = checks.map((row) => row.def);
    expect(defs.some((def) => def.includes("'video'") && def.includes("'creator'"))).toBe(true);
    expect(defs.some((def) => def.includes("'dynamic'"))).toBe(true);
    const indexes = await database<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'dynamic_metric_samples'
        AND indexname IN (
          'dynamic_samples_run',
          'dynamic_samples_source_at',
          'idx_dynamic_metric_samples_id_at'
        )
    `;
    expect(indexes.map((row) => row.indexname).sort()).toEqual([
      'dynamic_samples_run',
      'dynamic_samples_source_at',
      'idx_dynamic_metric_samples_id_at',
    ]);
    const rejected = await database`
      INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, interval_mode)
      VALUES (${crypto.randomUUID()}::uuid, 'dynamic', '8510000000000008888', 60, 'auto')
    `.catch((caught: unknown) => caught);
    expect(rejected).toBeInstanceOf(Error);
    const id = crypto.randomUUID();
    await database`
      INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, interval_mode)
      VALUES (${id}::uuid, 'dynamic', '8510000000000008888', 60, 'fixed')
    `;
    const targets = await database<{ n: string }[]>`
      SELECT count(*)::text AS n FROM monitor_targets WHERE id = ${id}::uuid
    `;
    expect(targets[0]?.n).toBe('1');
    await database`DELETE FROM monitor_targets WHERE id = ${id}::uuid`;
  });
});

async function insertCollectorChain(
  sql: Sql,
  externalId: string,
): Promise<{ accountId: string; runId: string }> {
  const accountId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await sql`INSERT INTO bili_accounts (id, status) VALUES (${accountId}::uuid, 'active')`;
  await sql`
    INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, source)
    VALUES (${targetId}::uuid, 'video', ${externalId}, 60, 'offline')
  `;
  await sql`
    INSERT INTO collector_jobs (id, target_id, status, scheduled_for)
    VALUES (${jobId}::uuid, ${targetId}::uuid, 'succeeded', now())
  `;
  await sql`
    INSERT INTO collector_runs (
      id, job_id, target_id, status, samples_written, duration_ms, started_at, finished_at
    ) VALUES (
      ${runId}::uuid, ${jobId}::uuid, ${targetId}::uuid, 'succeeded', 0, 5, now(), now()
    )
  `;
  return { accountId, runId };
}

async function readSample(
  sql: Sql,
  dynamicId: string,
): Promise<{
  id: string;
  dynamic_id: string;
  like_count: string | null;
  source: string;
  account_id: string | null;
  collector_run_id: string | null;
  marker: string | null;
}> {
  const [row] = await sql<
    {
      id: string;
      dynamic_id: string;
      like_count: string | null;
      source: string;
      account_id: string | null;
      collector_run_id: string | null;
      marker: string | null;
    }[]
  >`
    SELECT id::text AS id, dynamic_id, like_count::text AS like_count, source,
           account_id::text AS account_id, collector_run_id::text AS collector_run_id,
           extra->>'marker' AS marker
    FROM dynamic_metric_samples
    WHERE dynamic_id = ${dynamicId}
  `;
  if (!row) throw new Error(`样本不存在 ${dynamicId}`);
  return row;
}

function gate(parties: number): () => Promise<void> {
  let arrived = 0;
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= parties) open();
    await Promise.race([
      opened,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('并发屏障超时')), 5000);
      }),
    ]);
  };
}
