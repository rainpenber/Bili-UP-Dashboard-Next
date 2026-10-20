import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpTransport } from '@studio/monitoring';
import type { MonitorRefreshOptions } from './monitor-routes';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function detail(bvid: string) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        cid: 55,
        title: '离线标题',
        pubdate: 1_720_000_000,
        duration: 10,
        desc: 'd',
        tname: '',
        tname_v2: '',
        tid: 95,
        tid_v2: 2102,
        pic: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        owner: { mid: 7, name: 'UP' },
      },
      Tags: [{ tag_name: '标签' }],
    },
  };
}

const transport: HttpTransport = async (request) => {
  const bvid = new URL(request.url).searchParams.get('bvid') ?? 'BV1aptest411';
  return {
    status: 200,
    headers: {},
    durationMs: 1,
    body: JSON.stringify(detail(bvid)),
  };
};

/** Test-only offline backfill deps. Production never calls this. */
export function applyLifecycleBackfillTestDeps(
  monitor: MonitorRefreshOptions,
  env: NodeJS.ProcessEnv,
): void {
  monitor.transport = transport;
  monitor.download = async (request) => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: PNG,
    finalUrl: request.url,
  });
  monitor.assetsRoot = mkdtempSync(join(tmpdir(), 'lifecycle-backfill-'));
  monitor.ratePolicy = { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 };
  monitor.env = env;
  if (env.LOG_TEST_BACKFILL_HANG === '1') {
    monitor.gate = () => new Promise(() => undefined);
    return;
  }
  const raw = env.LOG_TEST_BACKFILL_HOLD_MS;
  if (raw === undefined || raw.trim() === '') return;
  const hold = Number(raw.trim());
  if (!Number.isInteger(hold) || hold < 0 || hold > 30_000) {
    throw new Error('LOG_TEST_BACKFILL_HOLD_MS 超出范围');
  }
  if (hold === 0) return;
  monitor.gate = () => new Promise((resolve) => setTimeout(resolve, hold));
}
