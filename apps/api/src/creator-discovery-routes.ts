import {
  MonitorContractError,
  parseCreatorDiscoveryConfig,
  parseCreatorDiscoveryConfigPutRequest,
  parseCreatorMid,
  parseCreatorPublishEventList,
  parseCreatorUploadsSyncResponse,
  parseCreatorUploadsSyncStatus,
  parseManualPublishEventCreateRequest,
  parsePublishEventId,
  parsePublishEventsQuery,
  parseUploadsSyncForce,
  type CreatorDiscoveryConfig,
  type CreatorPublishEvent,
  type ManualPublishEventCreateResponse,
} from '@studio/contracts';
import {
  defaultCreatorDiscoveryConfig,
  deleteManualCreatorPublishEvent,
  findActivePublishMonitorTargetId,
  findMonitorTargetByIdentity,
  getCreatorDiscoveryConfig,
  insertCreatorPublishEvent,
  listCreatorPublishEvents,
  upsertCreatorDiscoveryConfig,
  type CreatorPublishEventRow,
  type Sql,
} from '@studio/db';
import {
  BilibiliFailure,
  readCreatorUploadsSyncStatus,
  syncCreatorUploads,
  type CreatorArchivesPageProvider,
  type CreatorUploadsSyncEffects,
} from '@studio/monitoring';
import { Hono } from 'hono';
import type postgres from 'postgres';

export type CreatorUploadsSyncRouteDeps = {
  provider: CreatorArchivesPageProvider;
  effects: CreatorUploadsSyncEffects;
  forcedAccountId: string | null;
};

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

function toEventDto(
  event: CreatorPublishEventRow,
  monitoredTargetId: string | null,
): CreatorPublishEvent {
  const monitored = monitoredTargetId !== null;
  const navigable = event.eventKind === 'video' && monitored;
  return {
    id: event.id,
    mid: event.mid,
    eventKind: event.eventKind,
    externalId: event.externalId,
    publishedAt: event.publishedAt.toISOString(),
    titleSnapshot: event.titleSnapshot,
    firstDiscoveredAt: event.firstDiscoveredAt.toISOString(),
    source: event.source,
    monitored,
    monitoredTargetId,
    navigable,
  };
}

async function assertCreatorTargetOwned(sql: Sql, mid: string): Promise<void> {
  const target = await findMonitorTargetByIdentity(sql, 'creator', mid);
  if (!target || target.deletedAt) {
    throw new MonitorContractError('forbidden', '只能配置已监控的 UP 主发现选项');
  }
}

async function writePublishEventAudit(
  sql: Sql,
  input: {
    entityId: string | null;
    action: 'publish_event.manual.create' | 'publish_event.manual.delete';
    detail: postgres.JSONValue;
  },
): Promise<void> {
  await sql`
    INSERT INTO domain_audit_events (project_id, entity_type, entity_id, action, detail, source)
    VALUES (
      NULL,
      'creator_publish_event',
      ${input.entityId}::uuid,
      ${input.action},
      ${sql.json(input.detail)},
      'web'
    )
  `;
}

export function registerCreatorDiscoveryRoutes(
  app: Hono,
  sql: Sql,
  uploadsSync: CreatorUploadsSyncRouteDeps | null = null,
): void {
  app.get('/creators/:mid/uploads/sync', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      const status = parseCreatorUploadsSyncStatus(await readCreatorUploadsSyncStatus(sql, mid));
      return c.json(status);
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.post('/creators/:mid/uploads/sync', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      if (!uploadsSync) {
        return c.json({ error: '投稿同步未配置上游', code: 'unavailable' }, 503);
      }
      let body: unknown = {};
      try {
        const text = await c.req.text();
        body = text.trim() ? JSON.parse(text) : {};
      } catch {
        return c.json({ error: '请求体不是合法 JSON', code: 'invalid_body' }, 400);
      }
      const force = parseUploadsSyncForce(body, c.req.query('force'));
      const result = await syncCreatorUploads({
        sql,
        mid,
        force,
        provider: uploadsSync.provider,
        effects: uploadsSync.effects,
        forcedAccountId: uploadsSync.forcedAccountId,
      });
      return c.json(parseCreatorUploadsSyncResponse(result));
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      if (err instanceof BilibiliFailure) {
        const status =
          err.kind === 'risk_control' || err.kind === 'rate_limited'
            ? 503
            : err.kind === 'dry_run'
              ? 503
              : 502;
        return c.json({ error: err.message, code: err.kind }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

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
        items: await Promise.all(
          items.map(async (event): Promise<CreatorPublishEvent> => {
            const liveTargetId =
              event.monitoredTargetId ??
              (await findActivePublishMonitorTargetId(sql, {
                eventKind: event.eventKind,
                externalId: event.externalId,
              }));
            return toEventDto(event, liveTargetId);
          }),
        ),
      });
      return c.json(payload);
    } catch (err) {
      if (err instanceof MonitorContractError) {
        return c.json({ error: err.message, code: err.code }, 400);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.post('/creators/:mid/publish-events', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      const now = new Date();
      const body = parseManualPublishEventCreateRequest(await c.req.json(), now);
      const monitoredTargetId = await findActivePublishMonitorTargetId(sql, {
        eventKind: body.eventKind,
        externalId: body.externalId,
      });
      const { event, created } = await insertCreatorPublishEvent(sql, {
        id: crypto.randomUUID(),
        mid,
        eventKind: body.eventKind,
        externalId: body.externalId,
        publishedAt: new Date(body.publishedAt),
        titleSnapshot:
          body.title?.trim() || (body.eventKind === 'dynamic' ? '动态' : body.externalId),
        firstDiscoveredAt: now,
        monitoredTargetId,
        source: 'manual',
      });
      if (created) {
        await writePublishEventAudit(sql, {
          entityId: event.id,
          action: 'publish_event.manual.create',
          detail: {
            mid,
            eventKind: event.eventKind,
            externalId: event.externalId,
            publishedAt: event.publishedAt.toISOString(),
            titleSnapshot: event.titleSnapshot,
            monitoredTargetId: event.monitoredTargetId,
          },
        });
      }
      const resolvedTargetId =
        event.monitoredTargetId ??
        monitoredTargetId ??
        (await findActivePublishMonitorTargetId(sql, {
          eventKind: event.eventKind,
          externalId: event.externalId,
        }));
      const dto = toEventDto(event, resolvedTargetId);
      const response: ManualPublishEventCreateResponse = {
        created,
        event: dto,
        monitored: dto.monitored,
        monitoredTargetId: dto.monitoredTargetId,
      };
      return c.json(response, 200);
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.delete('/creators/:mid/publish-events/:eventId', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      await assertCreatorTargetOwned(sql, mid);
      const eventId = parsePublishEventId(c.req.param('eventId'));
      const result = await deleteManualCreatorPublishEvent(sql, { mid, eventId });
      if (result === 'not_found') {
        return c.json({ error: '发布事件不存在', code: 'not_found' }, 404);
      }
      if (result === 'manual_only') {
        return c.json({ error: '只能删除手动标记的发布事件', code: 'manual_only' }, 409);
      }
      await writePublishEventAudit(sql, {
        entityId: eventId,
        action: 'publish_event.manual.delete',
        detail: { mid, eventId },
      });
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof MonitorContractError) {
        const status = err.code === 'forbidden' ? 403 : 400;
        return c.json({ error: err.message, code: err.code }, status);
      }
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });
}
