import {
  MonitorContractError,
  bilibiliMediaProxyUrl,
  deriveMonitorCardState,
  monitorCardDisplayName,
  parseMonitorCard,
  parseMonitorCardIdentity,
  parseMonitorCardList,
  parseMonitorCardListQuery,
  type MonitorCard,
} from '@studio/contracts';
import {
  getMonitorCard,
  getStudioOwnerAccount,
  listMonitorCards,
  type MonitorCardRow,
  type Sql,
} from '@studio/db';
import type { Hono } from 'hono';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toMonitorCard(row: MonitorCardRow): MonitorCard {
  const derived = deriveMonitorCardState({
    hasTarget: row.targetId !== null,
    enabled: row.enabled,
    hasRunning: row.hasRunning,
    hasPending: row.hasPending,
    lastError: row.lastError,
  });
  return parseMonitorCard({
    type: row.type,
    externalId: row.externalId,
    title: row.title,
    category: row.category,
    imageAssetId: row.imageAssetId,
    imageUrl: row.imageUrl,
    imageProxyUrl: bilibiliMediaProxyUrl(row.imageUrl),
    mid: row.mid,
    displayName: monitorCardDisplayName(row.title, row.targetLabel, row.externalId),
    hasEntity: row.hasEntity,
    hasSamples: row.hasSamples,
    pinned: row.pinned,
    monitorState: derived.monitorState,
    execution: derived.execution,
    target:
      row.targetId === null
        ? null
        : {
            id: row.targetId,
            label: row.targetLabel ?? '',
            tags: row.tags,
            enabled: row.enabled === true,
            intervalMinutes: row.intervalMinutes ?? 0,
            intervalMode: row.intervalMode ?? 'auto',
            startAt: iso(row.startAt),
            nextRunAt: iso(row.nextRunAt),
            lastRunAt: iso(row.lastRunAt),
            lastSuccessAt: iso(row.lastSuccessAt),
            lastError: row.lastError,
          },
    projects: row.type === 'creator' ? [] : row.projects,
    latest: {
      sampledAt: iso(row.sampledAt),
      viewCount: row.viewCount,
      onlineViewers: row.onlineViewers,
      onlineViewersRaw: row.onlineViewersRaw,
      likeCount: row.likeCount,
      followerCount: row.followerCount,
    },
  });
}

function jsonError(err: unknown): {
  status: 400 | 404 | 500;
  body: { error: string; code: string };
} {
  if (err instanceof MonitorContractError) {
    return { status: 400, body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? err.message : '请求无法处理';
  return { status: 500, body: { error: message, code: 'internal' } };
}

export function registerMonitorCardRoutes(app: Hono, db: Sql): void {
  app.get('/cards', async (c) => {
    try {
      const query = parseMonitorCardListQuery({
        type: c.req.query('type'),
        monitor: c.req.query('monitor'),
        page: c.req.query('page'),
        pageSize: c.req.query('pageSize'),
        q: c.req.query('q'),
        category: c.req.query('category'),
        sort: c.req.query('sort'),
        onlyMine: c.req.query('onlyMine'),
        includeUnmonitored: c.req.query('includeUnmonitored'),
      });
      let ownerMid: string | null = null;
      if (query.onlyMine && query.type === 'video') {
        const owner = await getStudioOwnerAccount(db);
        if (!owner?.mid) {
          return c.json(
            {
              error: '尚未配置本人 B 站账号，请到集成与设置中填写 UID 后再开启「只看我的」',
              code: 'owner_account_not_configured',
            },
            400,
          );
        }
        ownerMid = owner.mid;
      }
      const listed = await listMonitorCards(db, {
        ...query,
        sort: query.sort,
        ownerMid,
        includeUnmonitored: query.includeUnmonitored,
      });
      const totalPages = Math.max(1, Math.ceil(listed.totalItems / query.pageSize));
      return c.json(
        parseMonitorCardList({
          page: query.page,
          pageSize: query.pageSize,
          totalItems: listed.totalItems,
          totalPages,
          items: listed.items.map(toMonitorCard),
        }),
      );
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.get('/cards/:type/:externalId', async (c) => {
    try {
      const identity = parseMonitorCardIdentity(c.req.param('type'), c.req.param('externalId'));
      const row = await getMonitorCard(db, identity.type, identity.externalId);
      if (!row) return c.json({ error: '未找到该对象', code: 'not_found' }, 404);
      return c.json(toMonitorCard(row));
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });
}
