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
  getMonitorTarget,
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
import type { StudioLogger } from '@studio/observability';
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
    intervalMode: row.intervalMode,
    startAt: iso(row.startAt),
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
  if (
    code === 'target_deleted' ||
    code === 'target_already_started' ||
    code === 'target_running' ||
    code === 'run_before_start'
  ) {
    return 409;
  }
  return 400;
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return left.getTime() === right.getTime();
}

type OperationEvent = {
  event: string;
  message: string;
  targetId: string;
  context: Record<string, unknown>;
};

function isLogger(value: unknown): value is StudioLogger {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'info' in value &&
    'flush' in value &&
    typeof (value as { info?: unknown }).info === 'function' &&
    typeof (value as { flush?: unknown }).flush === 'function',
  );
}

function contextLogger(c: { get?: (key: string) => unknown }): StudioLogger | null {
  if (!c.get) return null;
  try {
    const value = c.get('log');
    return isLogger(value) ? value : null;
  } catch {
    return null;
  }
}

function requestIdFrom(c: { get?: (key: string) => unknown }): string | null {
  if (!c.get) return null;
  try {
    const value = c.get('requestId');
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function identity(target: MonitorTargetRow): Record<string, unknown> {
  return {
    targetType: target.type,
    externalId: target.externalId,
    label: target.label,
    source: 'api',
  };
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function patchEvents(
  before: MonitorTargetRow,
  after: MonitorTargetRow,
  patch: {
    enabled?: boolean;
    intervalMinutes?: number;
    intervalMode?: 'auto' | 'fixed';
    tags?: string[];
    label?: string;
    startAt?: string | null;
  },
): OperationEvent[] {
  const events: OperationEvent[] = [];
  const base = identity(after);
  if (patch.enabled !== undefined && before.enabled !== after.enabled) {
    const action = after.enabled ? 'resume' : 'pause';
    events.push({
      event: after.enabled ? 'monitor.target.resumed' : 'monitor.target.paused',
      message: after.enabled ? '已恢复监控' : '已暂停监控',
      targetId: after.id,
      context: {
        ...base,
        action,
        changes: { enabled: { before: before.enabled, after: after.enabled } },
      },
    });
  }
  const intervalChanges: Record<string, { before: string | number; after: string | number }> = {};
  if (patch.intervalMinutes !== undefined && before.intervalMinutes !== after.intervalMinutes) {
    intervalChanges.intervalMinutes = {
      before: before.intervalMinutes,
      after: after.intervalMinutes,
    };
  }
  if (patch.intervalMode !== undefined && before.intervalMode !== after.intervalMode) {
    intervalChanges.intervalMode = { before: before.intervalMode, after: after.intervalMode };
  }
  if (Object.keys(intervalChanges).length > 0) {
    events.push({
      event: 'monitor.target.interval',
      message: '已调整采集频率',
      targetId: after.id,
      context: { ...base, action: 'interval', changes: intervalChanges },
    });
  }
  if (patch.label !== undefined && before.label !== after.label) {
    events.push({
      event: 'monitor.target.renamed',
      message: '已调整名称',
      targetId: after.id,
      context: {
        ...base,
        action: 'rename',
        changes: { label: { before: before.label, after: after.label } },
      },
    });
  }
  if (patch.tags !== undefined && !sameTags(before.tags, after.tags)) {
    events.push({
      event: 'monitor.target.tags',
      message: '已调整标签',
      targetId: after.id,
      context: {
        ...base,
        action: 'tags',
        changes: { tags: { before: before.tags, after: after.tags } },
      },
    });
  }
  if (patch.startAt !== undefined && !sameInstant(before.startAt, after.startAt)) {
    events.push({
      event: 'monitor.target.reschedule',
      message: '已调整计划开始时间',
      targetId: after.id,
      context: {
        ...base,
        action: 'reschedule',
        changes: {
          startAt: {
            before: iso(before.startAt),
            after: iso(after.startAt),
          },
        },
      },
    });
  }
  return events;
}

async function recordOperations(
  log: StudioLogger | null,
  requestId: string | null,
  events: OperationEvent[],
): Promise<void> {
  if (!log || events.length === 0) return;
  try {
    for (const event of events) {
      log.info(event.message, {
        event: event.event,
        targetId: event.targetId,
        ...(requestId ? { requestId } : {}),
        context: event.context,
      });
    }
    await log.flush();
  } catch {
    // The product write already committed. Logging is not a transaction, so a sink
    // failure must not turn that write into an error or invent a success row.
  }
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
      const startAt =
        request.startAt === undefined || request.startAt === null
          ? null
          : new Date(request.startAt);
      const result = await insertMonitorTarget(db, {
        id: crypto.randomUUID(),
        type: request.type,
        externalId: request.externalId,
        label: request.label,
        tags: request.tags,
        intervalMinutes: request.intervalMinutes,
        intervalMode: request.intervalMode,
        startAt,
        now,
      });
      if (result.created) {
        const createChanges: Record<string, { before: unknown; after: unknown }> = {
          label: { before: null, after: result.target.label },
          intervalMinutes: { before: null, after: result.target.intervalMinutes },
          enabled: { before: null, after: result.target.enabled },
          // Always record plan intent: null = immediate / no plan (not "unlogged").
          startAt: { before: null, after: iso(result.target.startAt) },
        };
        await recordOperations(contextLogger(c), requestIdFrom(c), [
          {
            event: 'monitor.target.created',
            message: '已添加监控项',
            targetId: result.target.id,
            context: {
              ...identity(result.target),
              action: 'create',
              changes: createChanges,
            },
          },
        ]);
      }
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
      const before = await getMonitorTarget(db, id);
      if (
        before &&
        !before.deletedAt &&
        before.type === 'dynamic' &&
        patch.intervalMode === 'auto'
      ) {
        throw new MonitorContractError('invalid_interval', '动态只支持固定间隔，不能使用自动频率');
      }
      // Non-null startAt on non-video is rejected. Explicit null on non-video is a no-op
      // (clients echo list/detail payloads); only video null clears the plan.
      if (
        before &&
        !before.deletedAt &&
        patch.startAt !== undefined &&
        patch.startAt !== null &&
        before.type !== 'video'
      ) {
        throw new MonitorContractError('invalid_start_at', '只有视频监控支持计划开始时间');
      }
      const dbPatch: {
        enabled?: boolean;
        intervalMinutes?: number;
        intervalMode?: 'auto' | 'fixed';
        tags?: string[];
        label?: string;
        startAt?: Date | null;
      } = {};
      if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
      if (patch.intervalMinutes !== undefined) dbPatch.intervalMinutes = patch.intervalMinutes;
      if (patch.intervalMode !== undefined) dbPatch.intervalMode = patch.intervalMode;
      if (patch.tags !== undefined) dbPatch.tags = patch.tags;
      if (patch.label !== undefined) dbPatch.label = patch.label;
      if (patch.startAt !== undefined) {
        const targetType = before?.type;
        if (targetType === 'video' || patch.startAt !== null) {
          dbPatch.startAt = patch.startAt === null ? null : new Date(patch.startAt);
        }
      }
      const result = await updateMonitorTarget(db, id, dbPatch, new Date());
      if (result.status === 'missing') {
        throw new MonitorContractError('target_not_found', '监控项不存在');
      }
      if (result.status === 'deleted' || !result.target) {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      if (result.status === 'already_started') {
        throw new MonitorContractError(
          'target_already_started',
          '该监控项已开始采集，不能再改计划开始时间',
        );
      }
      if (result.status === 'running') {
        throw new MonitorContractError('target_running', '该监控项正在采集，不能改计划开始时间');
      }
      if (result.status === 'invalid_start_type') {
        throw new MonitorContractError('invalid_start_at', '只有视频监控支持计划开始时间');
      }
      if (before && !before.deletedAt) {
        await recordOperations(
          contextLogger(c),
          requestIdFrom(c),
          patchEvents(before, result.target, patch),
        );
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
      await recordOperations(contextLogger(c), requestIdFrom(c), [
        {
          event: 'monitor.target.removed',
          message: '已移除监控项',
          targetId: result.target.id,
          context: {
            ...identity(result.target),
            action: 'remove',
            changes: { deleted: { before: false, after: true } },
          },
        },
      ]);
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
      if (result.status === 'deleted') {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      if (result.status === 'before_start') {
        throw new MonitorContractError(
          'run_before_start',
          '计划开始时间未到，请先修改开始时间后再手动采集',
        );
      }
      if (result.status !== 'queued' || !result.job) {
        throw new MonitorContractError('target_deleted', '监控项已删除');
      }
      const job = await getCollectorJob(db, result.job.id);
      if (!job) throw new MonitorContractError('target_not_found', '采集任务不存在');
      if (result.created) {
        const target = await getMonitorTarget(db, id);
        await recordOperations(contextLogger(c), requestIdFrom(c), [
          {
            event: 'monitor.target.run',
            message: '已请求一次采集',
            targetId: id,
            context: {
              targetType: target?.type ?? job.targetType,
              externalId: target?.externalId ?? job.externalId,
              label: target?.label ?? '',
              source: 'api',
              action: 'run',
              changes: { jobId: { before: null, after: job.id } },
            },
          },
        ]);
      }
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
