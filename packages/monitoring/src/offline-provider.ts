import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBilibiliRuntimeConfig } from './bilibili-config';
import { createBilibiliProvider } from './bilibili-provider';
import type { HttpTransport } from './bilibili-transport';
import { installOfflineFetchGuard } from './network-guard';
import type { ThrottleClock } from './throttle';

export type CollectedVideo = {
  bvid: string;
  title: string;
  sampledAt: Date;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute';
  viewCount: bigint;
  onlineViewers: bigint;
  onlineViewersRaw: string;
  likeCount: bigint;
  coinCount: bigint;
  favoriteCount: bigint;
  shareCount: bigint;
  danmakuCount: bigint;
  commentCount: bigint;
};

export type CollectedCreator = {
  mid: string;
  uname: string;
  sampledAt: Date;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute';
  followerCount: bigint;
};

export interface MonitorProvider {
  readonly id: string;
  collectVideo(externalId: string, sampledAt: Date): Promise<CollectedVideo>;
  collectCreator(externalId: string, sampledAt: Date): Promise<CollectedCreator>;
}

const bundledFixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/mock-data',
);

export function truncateToUtcMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

export function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function metric(seed: string, min: number, span: number): bigint {
  return BigInt(min + Math.floor(deterministicUnit(seed) * span));
}

export function formatSourceMinute(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

export function resolveOfflineFixtureRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MOCK_DATA_ROOT?.trim();
  const root = configured ? resolve(configured) : bundledFixtureRoot;
  if (!existsSync(root) || !existsSync(join(root, 'backend'))) {
    throw new Error(`离线夹具目录不可用: ${root}`);
  }
  return root;
}

function fixtureRequired(env: NodeJS.ProcessEnv): boolean {
  return env.OFFLINE_REQUIRE_FIXTURE === '1';
}

function sourceTimezone(env: NodeJS.ProcessEnv): string {
  const zone = env.SOURCE_TIMEZONE?.trim() || 'Asia/Shanghai';
  if (zone.length === 0 || zone.length > 64) throw new Error('SOURCE_TIMEZONE 不正确');
  return zone;
}

function readJsonTitle(root: string, fileName: string): string | null {
  const path = join(root, 'assets', fileName);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { title?: unknown; uname?: unknown };
  if (typeof parsed.title === 'string' && parsed.title.trim()) return parsed.title.trim();
  if (typeof parsed.uname === 'string' && parsed.uname.trim()) return parsed.uname.trim();
  return null;
}

function assertVideoFixture(root: string, bvid: string, required: boolean): void {
  if (!required) return;
  const csv = join(root, 'backend', `${bvid}_views.csv`);
  const meta = join(root, 'assets', `${bvid}.json`);
  if (!existsSync(csv) && !existsSync(meta)) {
    throw new Error(`离线夹具缺失: ${bvid}`);
  }
}

function assertCreatorFixture(root: string, mid: string, required: boolean): void {
  if (!required) return;
  const csv = join(root, 'backend', `${mid}_follower.csv`);
  if (!existsSync(csv)) throw new Error(`离线夹具缺失: ${mid}`);
}

export function createOfflineProvider(env: NodeJS.ProcessEnv = process.env): MonitorProvider {
  installOfflineFetchGuard();
  return {
    id: 'offline',
    async collectVideo(externalId: string, sampledAt: Date): Promise<CollectedVideo> {
      const root = resolveOfflineFixtureRoot(env);
      assertVideoFixture(root, externalId, fixtureRequired(env));
      const zone = sourceTimezone(env);
      const minute = truncateToUtcMinute(sampledAt);
      const seed = `${externalId}|${minute.toISOString()}`;
      const title = readJsonTitle(root, `${externalId}.json`) ?? `离线视频 ${externalId}`;
      const online = metric(`${seed}|online`, 0, 500);
      return {
        bvid: externalId,
        title,
        sampledAt: minute,
        rawTime: formatSourceMinute(minute, zone),
        sourceTimezone: zone,
        timestampPrecision: 'minute',
        viewCount: metric(`${seed}|view`, 100, 90_000),
        onlineViewers: online,
        onlineViewersRaw: online.toString(),
        likeCount: metric(`${seed}|like`, 0, 8_000),
        coinCount: metric(`${seed}|coin`, 0, 2_000),
        favoriteCount: metric(`${seed}|fav`, 0, 3_000),
        shareCount: metric(`${seed}|share`, 0, 1_000),
        danmakuCount: metric(`${seed}|danmaku`, 0, 1_500),
        commentCount: metric(`${seed}|comment`, 0, 800),
      };
    },
    async collectCreator(externalId: string, sampledAt: Date): Promise<CollectedCreator> {
      const root = resolveOfflineFixtureRoot(env);
      assertCreatorFixture(root, externalId, fixtureRequired(env));
      const zone = sourceTimezone(env);
      const minute = truncateToUtcMinute(sampledAt);
      const seed = `${externalId}|${minute.toISOString()}`;
      return {
        mid: externalId,
        uname: `离线 UP ${externalId}`,
        sampledAt: minute,
        rawTime: formatSourceMinute(minute, zone),
        sourceTimezone: zone,
        timestampPrecision: 'minute',
        followerCount: metric(`${seed}|fans`, 1_000, 1_000_000),
      };
    },
  };
}

export function createMonitorProvider(
  kind: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: {
    transport?: HttpTransport;
    random?: () => number;
    clock?: ThrottleClock;
    log?: (line: string) => void;
  } = {},
): MonitorProvider {
  if (kind === 'offline' || kind === 'mock') return createOfflineProvider(env);
  if (kind === 'bilibili') return createBilibiliProvider(readBilibiliRuntimeConfig(env), overrides);
  throw new Error(`采集源 ${kind} 未实现（fail closed）。不会访问 Bilibili。`);
}
