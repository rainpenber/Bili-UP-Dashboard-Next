import type { BinaryTransport, HttpTransport } from '@studio/monitoring';
import { lifecycleTestEnabled } from '@studio/observability';
import type { MonitorRefreshOptions } from './monitor-routes';

export const LIFECYCLE_HOLD_HEADER = 'x-lifecycle-hold';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const REJECTED_BACKFILL =
  'metadata-backfill-rejected SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a Bearer abc.def-GHI_9';

function readDelayMs(raw: string | undefined, name: string): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error(`${name} 超出范围`);
  }
  return value;
}

function detailBody(bvid: string) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        aid: 99,
        cid: 123456789,
        title: '接口标题',
        pubdate: 1_720_000_000,
        duration: 95,
        desc: '简介',
        tname: '',
        tname_v2: '',
        tid: 95,
        tid_v2: 2102,
        pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
        owner: { mid: 42, name: 'UP', face: 'https://i1.hdslb.com/bfs/face/a.jpg' },
      },
      Tags: [{ tag_name: '测评' }, { tag_name: '开箱' }],
      Card: {
        card: { name: '卡片名', face: 'https://i1.hdslb.com/bfs/face/a.jpg', sign: '签名' },
        follower: 20,
        archive_count: 3,
      },
    },
  };
}

/** Fixture view/detail response. Never calls fetch. */
export function offlineMetadataTransport(): HttpTransport {
  return async (request) => {
    const bvid = new URL(request.url).searchParams.get('bvid') ?? 'BV1aptest411';
    return {
      status: 200,
      headers: {},
      durationMs: 1,
      body: JSON.stringify(detailBody(bvid)),
    };
  };
}

/** Fixture image bytes. Never calls fetch. */
export function offlineAssetDownload(): BinaryTransport {
  return async (request) => ({
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: PNG,
    finalUrl: request.url,
  });
}

export function readLifecycleHoldMs(env: NodeJS.ProcessEnv = process.env): number {
  if (!lifecycleTestEnabled(env)) return 0;
  return readDelayMs(env.API_LIFECYCLE_HTTP_HOLD_MS, 'API_LIFECYCLE_HTTP_HOLD_MS');
}

function backfillGate(env: NodeJS.ProcessEnv): (() => Promise<void>) | undefined {
  if (env.API_LIFECYCLE_BACKFILL === 'hang') {
    return () => new Promise(() => undefined);
  }
  const delayMs = readDelayMs(
    env.API_LIFECYCLE_BACKFILL_DELAY_MS,
    'API_LIFECYCLE_BACKFILL_DELAY_MS',
  );
  if (delayMs === 0) return undefined;
  return () => new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Test-only refresh deps. Production env (without the lifecycle flag) gets none of these. */
export function lifecycleMetadataOverrides(
  env: NodeJS.ProcessEnv = process.env,
): MonitorRefreshOptions {
  if (!lifecycleTestEnabled(env)) return {};
  const gate = backfillGate(env);
  return {
    transport: offlineMetadataTransport(),
    download: offlineAssetDownload(),
    ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
    random: () => 0,
    ...(gate ? { gate } : {}),
  };
}

/**
 * Always track the real backfill promise. In the lifecycle reject mode, also track
 * the same task ending in a rejection so shutdown sees that failure and still waits
 * for the original work.
 */
export function trackLifecycleBackfill(
  env: NodeJS.ProcessEnv,
  task: Promise<void>,
  track: (task: Promise<unknown>) => void,
): void {
  track(task);
  if (!lifecycleTestEnabled(env) || env.API_LIFECYCLE_BACKFILL !== 'reject') return;
  track(
    task.then(() => {
      throw new Error(REJECTED_BACKFILL);
    }),
  );
}
