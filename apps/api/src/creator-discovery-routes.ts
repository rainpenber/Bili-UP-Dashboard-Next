import {
  MonitorContractError,
  parseCreatorDiscoveryConfig,
  parseCreatorDiscoveryConfigPutRequest,
  parseCreatorMid,
  parseCreatorPublishEventList,
  parsePublishEventsQuery,
  type CreatorDiscoveryConfig,
  type CreatorPublishEvent,
} from '@studio/contracts';
import {
  defaultCreatorDiscoveryConfig,
  findMonitorTargetByIdentity,
  getCreatorDiscoveryConfig,
  listCreatorPublishEvents,
  upsertCreatorDiscoveryConfig,
  type Sql,
} from '@studio/db';
import { Hono } from 'hono';

function toConfigDto(
  row: ReturnType<typeof defaultCreatorDiscoveryConfig>,
): CreatorDiscoveryConfig {
  return parseCreatorDiscoveryConfig({
    mid: row.mid,
    enabled: row.enabled,
    discoverVideos: row.discoverVideos,
    discoverDynamics: row.discoverDynamics,
    monitorNewVideos: row.monitorNewVideos,
    discoveryTargetId: row.discoveryTargetId,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    suppressedAutoCreateTotal: row.suppressedAutoCreateTotal,
    updatedAt: row.updatedAt.getTime() === 0 ? null : row.updatedAt.toISOString(),
  });
}

async function assertCreatorTargetOwned(sql: Sql, mid: string): Promise<void> {
  const target = await findMonitorTargetByIdentity(sql, 'creator', mid);
  if (!target || target.deletedAt) {
    throw new MonitorContractError('forbidden', '只能配置已监控的 UP 主发现选项');
  }
}

export function registerCreatorDiscoveryRoutes(app: Hono, sql: Sql): void {
  app.get('/creators/:mid/discovery', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      const row = (await getCreatorDiscoveryConfig(sql, mid)) ?? defaultCreatorDiscoveryConfig(mid);
      return c.json(toConfigDto({ ...row, mid }));
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.put('/creators/:mid/discovery', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      const body = parseCreatorDiscoveryConfigPutRequest(await c.req.json());
      const { config } = await upsertCreatorDiscoveryConfig(sql, {
        mid,
        enabled: body.enabled,
        discoverVideos: body.discoverVideos,
        discoverDynamics: body.discoverDynamics,
        monitorNewVideos: body.monitorNewVideos,
        now: new Date(),
      });
      return c.json(toConfigDto(config));
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/creators/:mid/publish-events', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      const raw = c.req.query();
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(raw)) {
        if (value !== undefined) params.set(key, value);
      }
      const query = parsePublishEventsQuery(params);
      const offset = (query.page - 1) * query.pageSize;
      const { items, totalItems } = await listCreatorPublishEvents(sql, {
        mid,
        from: query.from,
        to: query.to,
        limit: query.pageSize,
        offset,
      });
      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize);
      const payload = parseCreatorPublishEventList({
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
        items: items.map((event): CreatorPublishEvent => {
          const monitored = event.monitoredTargetId !== null;
          const navigable = event.eventKind === 'video' && monitored;
          return {
            id: event.id,
            mid: event.mid,
            eventKind: event.eventKind,
            externalId: event.externalId,
            publishedAt: event.publishedAt.toISOString(),
            titleSnapshot: event.titleSnapshot,
            firstDiscoveredAt: event.firstDiscoveredAt.toISOString(),
            source: 'bilibili',
            monitored,
            monitoredTargetId: event.monitoredTargetId,
            navigable,
          };
        }),
      });
      return c.json(payload);
    } catch (err) {
      if (err instanceof MonitorContractError) {
        return c.json({ error: err.message, code: err.code }, 400);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });
}
