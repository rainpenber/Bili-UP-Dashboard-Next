import {
  MonitorContractError,
  parseCollectorJob,
  parseCreateMonitorTargetRequest,
  parseMonitorListQuery,
  parseMonitorTarget,
  parseMonitorTargetId,
  parsePatchMonitorTargetRequest,
  type CollectorJob,
  type MonitorTarget,
} from '@studio/contracts';
import {
  getCollectorJob,
  insertMonitorTarget,
  listCollectorJobs,
  listMonitorTargets,
  requestCollectorRun,
  softDeleteMonitorTarget,
  updateMonitorTarget,
  type CollectorJobRow,
  type MonitorTargetRow,
  type Sql,
} from '@studio/db';
import type { Hono } from 'hono';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toMonitorTarget(row: MonitorTargetRow): MonitorTarget {
  return parseMonitorTarget({
    id: row.id,
    type: row.type,
    externalId: row.externalId,
    label: row.label,
    tags: row.tags,
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    nextRunAt: iso(row.nextRunAt),
    lastRunAt: iso(row.lastRunAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastError: row.lastError,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
  });
}

export function toCollectorJob(row: CollectorJobRow): CollectorJob {
  return parseCollectorJob({
    id: row.id,
    targetId: row.targetId,
    targetType: row.targetType,
    externalId: row.externalId,
    status: row.status,
    attempts: row.attempts,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    error: row.error,
    latestRun: row.latestRun
      ? {
          id: row.latestRun.id,
          status: row.latestRun.status,
          samplesWritten: row.latestRun.samplesWritten,
          durationMs: row.latestRun.durationMs,
          error: row.latestRun.error,
          finishedAt: row.latestRun.finishedAt.toISOString(),
        }
      : null,
  });
}

function statusForCode(code: string): 400 | 404 | 409 {
  if (code === 'target_not_found') return 404;
  if (code === 'target_deleted') return 409;
  return 400;
}

function jsonError(err: unknown): {
  status: 400 | 404 | 409 | 500;
  body: { error: string; code: string };
} {
  if (err instanceof MonitorContractError) {
    return { status: statusForCode(err.code), body: { error: err.message, code: err.code } };
  }
  const message = err instanceof Error ? err.message : '请求无法处理';
  return { status: 500, body: { error: message, code: 'internal' } };
}

export function registerMonitorTargetRoutes(app: Hono, db: Sql): void {
  app.get('/targets', async (c) => {
    try {
      const { page, pageSize } = parseMonitorListQuery(
        c.req.query('page'),
        c.req.query('pageSize'),
      );
      const includeDeleted = c.req.query('includeDeleted') === '1';
      const listed = await listMonitorTargets(db, { page, pageSize, includeDeleted });
      const totalPages = Math.max(1, Math.ceil(listed.totalItems / pageSize));
      return c.json({
        page,
        pageSize,
        totalItems: listed.totalItems,
        totalPages,
        items: listed.items.map(toMonitorTarget),
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.post('/targets', async (c) => {
    try {
      const body = await c.req.json().catch(() => {
        throw new MonitorContractError('invalid_body', '请求体不是合法的监控项');
      });
      const request = parseCreateMonitorTargetRequest(body);
      const now = new Date();
      const result = await insertMonitorTarget(db, {
        id: crypto.randomUUID(),
        type: request.type,
        externalId: request.externalId,
        label: request.label,
        tags: request.tags,
        intervalMinutes: request.intervalMinutes,
        now,
      });
      return c.json({
        target: toMonitorTarget(result.target),
        created: result.created,
        code: result.created ? 'created' : 'target_exists',
        message: result.created ? '已添加监控项' : '该监控项已存在，已返回原记录',
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.patch('/targets/:id', async (c) => {
    try {
      const id = parseMonitorTargetId(c.req.param('id'));
      const body = await c.req.json().catch(() => {
        throw new MonitorContractError('invalid_body', '请求体不是合法的监控项更新');
      });
      const patch = parsePatchMonitorTargetRequest(body);
      const result = await updateMonitorTarget(db, id, patch, new Date());
      if (result.status === 'missing') {
        throw new MonitorContractError('target_not_found', '监控项不存在');
      }
      if (result.status === 'deleted' || !result.target) {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      return c.json({ target: toMonitorTarget(result.target) });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.delete('/targets/:id', async (c) => {
    try {
      const id = parseMonitorTargetId(c.req.param('id'));
      const result = await softDeleteMonitorTarget(db, id);
      if (result.status === 'missing') {
        throw new MonitorContractError('target_not_found', '监控项不存在');
      }
      if (result.status === 'deleted' || !result.target) {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      return c.json({ target: toMonitorTarget(result.target), deleted: true });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.post('/targets/:id/run', async (c) => {
    try {
      const id = parseMonitorTargetId(c.req.param('id'));
      const result = await requestCollectorRun(db, id, new Date());
      if (result.status === 'missing') {
        throw new MonitorContractError('target_not_found', '监控项不存在');
      }
      if (result.status === 'deleted' || !result.job) {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      const job = await getCollectorJob(db, result.job.id);
      if (!job) throw new MonitorContractError('target_not_found', '采集任务不存在');
      return c.json({
        job: toCollectorJob(job),
        created: result.created,
        message: result.created ? '已安排立即采集' : '该时刻的采集任务已存在',
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });

  app.get('/jobs', async (c) => {
    try {
      const { page, pageSize } = parseMonitorListQuery(
        c.req.query('page'),
        c.req.query('pageSize'),
      );
      const listed = await listCollectorJobs(db, { page, pageSize });
      const totalPages = Math.max(1, Math.ceil(listed.totalItems / pageSize));
      return c.json({
        page,
        pageSize,
        totalItems: listed.totalItems,
        totalPages,
        items: listed.items.map(toCollectorJob),
      });
    } catch (err) {
      const failure = jsonError(err);
      return c.json(failure.body, failure.status);
    }
  });
}
