import { afterAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  createEmptyIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  runMigrations,
  seedPartitions,
  writeVideoSample,
} from '@studio/db';
import { createMonitorRoutes } from './monitor-routes';

const bvid = 'BV1jHnn63EEi';

function sample(partition: {
  tid: number | null;
  tidV2: number | null;
  tname: string;
  tnameV2: string;
}) {
  return {
    bvid,
    title: '实测',
    sampledAt: new Date('2026-10-19T12:00:00.000Z'),
    rawTime: '2026-10-19 20:00',
    sourceTimezone: 'Asia/Shanghai',
    timestampPrecision: 'minute' as const,
    viewCount: 1n,
    onlineViewers: null,
    onlineViewersRaw: null,
    likeCount: 0n,
    coinCount: 0n,
    favoriteCount: 0n,
    shareCount: 0n,
    danmakuCount: 0n,
    commentCount: 0n,
    partition,
  };
}

describe('video partition read fallback', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) {
      await dropIsolatedTestDatabase(name).catch(() => undefined);
    }
  });

  test('stores an empty tname as null, then resolves tid_v2 and tid from the dictionary', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql = isolated.sql;
    try {
      await runMigrations(sql);
      await writeVideoSample(sql, sample({ tid: 95, tidV2: 2102, tname: '', tnameV2: '  ' }));
      await writeVideoSample(sql, sample({ tid: 95, tidV2: 2102, tname: '未知', tnameV2: '其他' }));
      const [stored] = await sql<
        { partition_name: string | null; metadata: Record<string, unknown> }[]
      >`
        SELECT partition_name, metadata FROM videos WHERE bvid = ${bvid}
      `;
      expect(stored?.partition_name ?? null).toBeNull();
      expect(stored?.metadata.tid).toBe(95);
      expect(stored?.metadata.tid_v2).toBe(2102);
      expect(stored?.metadata.tname).toBe('未知');
      expect(stored?.metadata.tname_v2).toBe('其他');

      const app = new Hono();
      app.route('/api/v1/monitor', createMonitorRoutes(sql));
      const missing = await app.request(`/api/v1/monitor/videos/${bvid}`);
      expect(missing.status).toBe(200);
      const missingBody = (await missing.json()) as {
        partitionName: string | null;
        tid: number;
        tidV2: number;
      };
      expect(missingBody.partitionName).toBeNull();
      expect(missingBody.tid).toBe(95);
      expect(missingBody.tidV2).toBe(2102);

      await seedPartitions(sql, [{ tid: 2102, parentTid: 95, name: '知识', source: 'manual' }]);
      const byV2 = (await (await app.request(`/api/v1/monitor/videos/${bvid}`)).json()) as {
        partitionName: string | null;
      };
      expect(byV2.partitionName).toBe('知识');

      await sql`DELETE FROM bili_partitions WHERE tid = 2102`;
      await seedPartitions(sql, [{ tid: 95, parentTid: null, name: '旧分区', source: 'import' }]);
      const byTid = (await (await app.request(`/api/v1/monitor/videos/${bvid}`)).json()) as {
        partitionName: string | null;
      };
      expect(byTid.partitionName).toBe('旧分区');

      await sql`DELETE FROM bili_partitions`;
      const gone = (await (await app.request(`/api/v1/monitor/videos/${bvid}`)).json()) as {
        partitionName: string | null;
      };
      expect(gone.partitionName).toBeNull();

      await writeVideoSample(sql, sample({ tid: 95, tidV2: 2102, tname: '', tnameV2: '科技' }));
      const named = (await (await app.request(`/api/v1/monitor/videos/${bvid}`)).json()) as {
        partitionName: string | null;
      };
      expect(named.partitionName).toBe('科技');
      await writeVideoSample(sql, sample({ tid: 95, tidV2: 2102, tname: '', tnameV2: '' }));
      const kept = (await (await app.request(`/api/v1/monitor/videos/${bvid}`)).json()) as {
        partitionName: string | null;
      };
      expect(kept.partitionName).toBe('科技');
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
