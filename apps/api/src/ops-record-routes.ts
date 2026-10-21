import {
  OPS_OPERATION_EVENTS,
  OPS_TARGET_SEARCH_LIMIT,
  OPS_PROJECT_SEARCH_LIMIT,
  operationActionForEvent,
  parseOpsCollectorJobQuery,
  resolveOpsRange,
  type OpsCollectorAttempt,
  type OpsCollectorJob,
  type OpsCollectorJobDetail,
  type OpsCollectorJobGroups,
  type OpsCollectorJobList,
  type OpsLogNote,
  type OpsLogRetention,
  type OpsOperation,
  type OpsOperationAction,
  type OpsOperationChange,
  type OpsOperationList,
  type OpsRecordLog,
} from '@studio/contracts';
import {
  countOpsCollectorJobGroups,
  countOpsCollectorJobs,
  countOpsJobAttempts,
  countOpsOperations,
  listOpsCollectorJobGroups,
  listOpsCollectorJobs,
  listOpsJobAttempts,
  listOpsJobLevelLogs,
  listOpsLogsForRuns,
  listOpsOperations,
  listOpsRequestsForRuns,
  readOpsCollectorJob,
  readOpsLogRetention,
  searchOpsCollectorTargets,
  searchOpsProjects,
  type OpsJobRead,
  type OpsLogRead,
  type OpsRequestRead,
  type Sql,
} from '@studio/db';
import { readRetentionDays } from '@studio/observability';
import { scrubString, scrubValue } from '@studio/observability/redact';
import type { Hono } from 'hono';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_BY_ACTION: Record<OpsOperationAction, (typeof OPS_OPERATION_EVENTS)[number]> = {
  create: 'monitor.target.created',
  pause: 'monitor.target.paused',
  resume: 'monitor.target.resumed',
  interval: 'monitor.target.interval',
  rename: 'monitor.target.renamed',
  tags: 'monitor.target.tags',
  remove: 'monitor.target.removed',
  run: 'monitor.target.run',
  reschedule: 'monitor.target.reschedule',
};

type Ctx = {
  req: { query: (name: string) => string | undefined; param: (name: string) => string };
  json: (body: unknown, status?: number) => Response;
};

function guard(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx) => {
    try {
      return await handler(c);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bad request';
      if (message.startsWith('invalid')) return c.json({ error: message }, 400);
      throw error;
    }
  };
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const text = scrubString(value);
  return text.length === 0 ? null : text;
}

function cleanContext(value: unknown): Record<string, unknown> {
  const scrubbed = scrubValue(value ?? {});
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) return {};
  return scrubbed as Record<string, unknown>;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapLog(row: OpsLogRead): OpsRecordLog {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    level: row.level,
    service: row.service,
    event: row.event,
    message: scrubString(row.message),
    requestId: row.requestId,
    runId: row.runId,
    context: cleanContext(row.context),
  };
}

function mapRequest(row: OpsRequestRead) {
  return {
    id: row.id,
    endpoint: scrubString(row.endpoint),
    statusCode: row.statusCode,
    bizCode: row.bizCode,
    durationMs: row.durationMs,
    error: cleanText(row.error),
    requestedAt: row.requestedAt.toISOString(),
    runId: row.runId,
  };
}

function mapJob(row: OpsJobRead): OpsCollectorJob {
  return {
    id: row.id,
    targetId: row.targetId,
    targetType: row.targetType,
    externalId: row.externalId,
    label: scrubString(row.label),
    displayName: scrubString(row.displayName),
    coverUrl: cleanText(row.coverUrl),
    targetDeleted: row.targetDeleted,
    status: row.status,
    attempts: row.attempts,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    durationMs: row.durationMs,
    samplesWritten: row.samplesWritten,
    error: cleanText(row.error),
    latestAttempt: row.latestAttempt
      ? {
          id: row.latestAttempt.id,
          status: row.latestAttempt.status,
          samplesWritten: row.latestAttempt.samplesWritten,
          durationMs: row.latestAttempt.durationMs,
          error: cleanText(row.latestAttempt.error),
          startedAt: row.latestAttempt.startedAt.toISOString(),
          finishedAt: row.latestAttempt.finishedAt.toISOString(),
        }
      : null,
    projects: row.projects.map((project) => ({
      id: project.id,
      name: scrubString(project.name),
    })),
  };
}

async function retentionOf(db: Sql): Promise<OpsLogRetention> {
  const read = await readOpsLogRetention(db, readRetentionDays());
  return {
    days: read.days,
    cutoff: read.cutoff.toISOString(),
    oldestStoredAt: iso(read.oldestStoredAt),
    timezone: 'Asia/Shanghai',
  };
}

function logNote(finishedAt: Date, logCount: number, cutoff: string): OpsLogNote | null {
  if (logCount > 0) return null;
  if (finishedAt.getTime() < Date.parse(cutoff)) return '关联日志已过保留期';
  return '暂无关联日志';
}

function parseSearchLimit(raw: string | undefined, max: number): number {
  if (raw === undefined || raw.trim() === '') return max;
  if (!/^\d+$/.test(raw.trim())) throw new Error('invalid limit');
  const value = Number(raw.trim());
  if (value < 1) throw new Error('invalid limit');
  return Math.min(value, max);
}

function parseAttemptPage(
  raw: string | undefined,
  name: string,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`invalid ${name}`);
  const value = Number(raw.trim());
  if (value < 1 || value > 10000) throw new Error(`invalid ${name}`);
  return Math.min(value, max);
}

function changeValue(value: unknown): OpsOperationChange['before'] | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.map((item) => scrubString(item));
  }
  return undefined;
}

function changesOf(value: unknown): Record<string, OpsOperationChange> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const changes: Record<string, OpsOperationChange> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as { before?: unknown; after?: unknown };
    const before = changeValue(row.before);
    const after = changeValue(row.after);
    if (before === undefined || after === undefined) continue;
    changes[key] = {
      before: typeof before === 'string' ? scrubString(before) : before,
      after: typeof after === 'string' ? scrubString(after) : after,
    };
  }
  return changes;
}

function mapOperation(row: {
  id: string;
  ts: Date;
  event: string;
  requestId: string | null;
  targetId: string | null;
  context: unknown;
}): OpsOperation | null {
  const action = operationActionForEvent(row.event);
  if (!action) return null;
  const context = cleanContext(row.context);
  const targetType =
    context.targetType === 'video' ||
    context.targetType === 'creator' ||
    context.targetType === 'dynamic'
      ? context.targetType
      : null;
  const externalId =
    typeof context.externalId === 'string' ? scrubString(context.externalId) : null;
  const label = typeof context.label === 'string' ? scrubString(context.label) : null;
  const actor =
    typeof context.actor === 'string' && context.actor.trim().length > 0
      ? scrubString(context.actor.trim())
      : null;
  const source =
    typeof context.source === 'string' && context.source.trim().length > 0
      ? scrubString(context.source.trim())
      : null;
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    action,
    event: EVENT_BY_ACTION[action],
    targetId: row.targetId,
    targetType,
    externalId: externalId && externalId.length > 0 ? externalId : null,
    label,
    actor: actor && actor.length > 0 ? actor : null,
    source: source && source.length > 0 ? source : null,
    requestId: row.requestId,
    changes: changesOf(context.changes),
  };
}

export function registerOpsRecordRoutes(app: Hono, db: Sql): void {
  app.get(
    '/collector-jobs',
    guard(async (c) => {
      const query = parseOpsCollectorJobQuery({
        type: c.req.query('type'),
        targetId: c.req.query('targetId'),
        externalId: c.req.query('externalId'),
        q: c.req.query('q'),
        status: c.req.query('status'),
        since: c.req.query('since'),
        until: c.req.query('until'),
        projectId: c.req.query('projectId'),
        group: c.req.query('group'),
        page: c.req.query('page'),
        pageSize: c.req.query('pageSize'),
        jobsPerGroup: c.req.query('jobsPerGroup'),
      });
      const range = resolveOpsRange(query.since, query.until);
      const filter = { ...query, since: range.since, until: range.until };
      const logRetention = await retentionOf(db);
      if (query.group === 'target') {
        const [total, groups] = await Promise.all([
          countOpsCollectorJobGroups(db, filter),
          listOpsCollectorJobGroups(db, filter, query.page, query.pageSize, query.jobsPerGroup),
        ]);
        const body: OpsCollectorJobGroups = {
          mode: 'target',
          items: groups.map((group) => ({
            targetId: group.targetId,
            targetType: group.targetType,
            externalId: group.externalId,
            label: scrubString(group.label),
            displayName: scrubString(group.displayName),
            coverUrl: cleanText(group.coverUrl),
            targetDeleted: group.targetDeleted,
            matchCount: group.matchCount,
            truncated: group.matchCount > group.jobs.length,
            jobs: group.jobs.map(mapJob),
          })),
          total,
          page: query.page,
          pageSize: query.pageSize,
          jobsPerGroup: query.jobsPerGroup,
          range,
          logRetention,
        };
        return c.json(body);
      }
      const [total, items] = await Promise.all([
        countOpsCollectorJobs(db, filter),
        listOpsCollectorJobs(db, filter, query.page, query.pageSize),
      ]);
      const body: OpsCollectorJobList = {
        mode: 'time',
        items: items.map(mapJob),
        total,
        page: query.page,
        pageSize: query.pageSize,
        range,
        logRetention,
      };
      return c.json(body);
    }),
  );

  app.get(
    '/collector-jobs/:id',
    guard(async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) throw new Error('invalid jobId');
      const job = await readOpsCollectorJob(db, id);
      if (!job) return c.json({ error: 'not found' }, 404);
      const attemptPage = parseAttemptPage(c.req.query('attemptPage'), 'attemptPage', 1, 10000);
      const attemptPageSize = parseAttemptPage(
        c.req.query('attemptPageSize'),
        'attemptPageSize',
        10,
        20,
      );
      const [attemptTotal, attempts, jobLogs, logRetention] = await Promise.all([
        countOpsJobAttempts(db, id),
        listOpsJobAttempts(db, id, attemptPage, attemptPageSize),
        listOpsJobLevelLogs(db, id),
        retentionOf(db),
      ]);
      const runIds = attempts.map((attempt) => attempt.id);
      const [requests, logs] = await Promise.all([
        listOpsRequestsForRuns(db, runIds),
        listOpsLogsForRuns(db, runIds),
      ]);
      const requestByRun = new Map<string, OpsRequestRead[]>();
      for (const request of requests.items) {
        if (!request.runId) continue;
        const list = requestByRun.get(request.runId) ?? [];
        list.push(request);
        requestByRun.set(request.runId, list);
      }
      const logByRun = new Map<string, OpsLogRead[]>();
      for (const entry of logs.items) {
        if (!entry.runId) continue;
        const list = logByRun.get(entry.runId) ?? [];
        list.push(entry);
        logByRun.set(entry.runId, list);
      }
      const body: OpsCollectorJobDetail = {
        job: mapJob(job),
        attempts: attempts.map((attempt) => {
          const attemptLogs = logByRun.get(attempt.id) ?? [];
          const mapped: OpsCollectorAttempt = {
            id: attempt.id,
            status: attempt.status,
            samplesWritten: attempt.samplesWritten,
            durationMs: attempt.durationMs,
            error: cleanText(attempt.error),
            startedAt: attempt.startedAt.toISOString(),
            finishedAt: attempt.finishedAt.toISOString(),
            requests: (requestByRun.get(attempt.id) ?? []).map(mapRequest),
            requestsTruncated: requests.truncatedRunIds.includes(attempt.id),
            logs: attemptLogs.map(mapLog),
            logsTruncated: logs.truncatedRunIds.includes(attempt.id),
            logNote: logNote(attempt.finishedAt, attemptLogs.length, logRetention.cutoff),
          };
          return mapped;
        }),
        attemptTotal,
        attemptPage,
        attemptPageSize,
        jobLogs: jobLogs.items.map(mapLog),
        jobLogsTruncated: jobLogs.truncated,
        logRetention,
      };
      return c.json(body);
    }),
  );

  app.get(
    '/collector-targets',
    guard(async (c) => {
      const q = c.req.query('q')?.trim() ?? '';
      if (q.length === 0) return c.json({ items: [], limit: OPS_TARGET_SEARCH_LIMIT });
      const type = c.req.query('type')?.trim() ?? '';
      if (
        type !== '' &&
        type !== 'all' &&
        type !== 'video' &&
        type !== 'creator' &&
        type !== 'dynamic'
      ) {
        throw new Error('invalid type');
      }
      const limit = parseSearchLimit(c.req.query('limit'), OPS_TARGET_SEARCH_LIMIT);
      const items = await searchOpsCollectorTargets(db, {
        q: q.slice(0, 200),
        type: type === '' || type === 'all' ? null : (type as 'video' | 'creator' | 'dynamic'),
        limit,
      });
      return c.json({
        items: items.map((item) => ({
          ...item,
          label: scrubString(item.label),
          displayName: scrubString(item.displayName),
        })),
        limit,
      });
    }),
  );

  app.get(
    '/projects',
    guard(async (c) => {
      const q = c.req.query('q')?.trim() ?? '';
      const limit = parseSearchLimit(c.req.query('limit'), OPS_PROJECT_SEARCH_LIMIT);
      if (q.length === 0) return c.json({ items: [], limit });
      const items = await searchOpsProjects(db, { q: q.slice(0, 200), limit });
      return c.json({
        items: items.map((item) => ({ id: item.id, name: scrubString(item.name) })),
        limit,
      });
    }),
  );

  app.get(
    '/operations',
    guard(async (c) => {
      const actionRaw = c.req.query('action')?.trim() ?? '';
      if (actionRaw !== '' && actionRaw !== 'all' && !Object.hasOwn(EVENT_BY_ACTION, actionRaw)) {
        throw new Error('invalid action');
      }
      const action =
        actionRaw === '' || actionRaw === 'all' ? null : (actionRaw as OpsOperationAction);
      const targetId = c.req.query('targetId');
      if (targetId && targetId.trim() !== '' && !UUID.test(targetId.trim())) {
        throw new Error('invalid targetId');
      }
      const since = c.req.query('since');
      const until = c.req.query('until');
      const range = resolveOpsRange(
        since && since.trim() !== '' ? since.trim() : null,
        until && until.trim() !== '' ? until.trim() : null,
      );
      const page = parseAttemptPage(c.req.query('page'), 'page', 1, 10000);
      const pageSize = parseAttemptPage(c.req.query('pageSize'), 'pageSize', 20, 50);
      const requestId = c.req.query('requestId')?.trim() || null;
      const filter = {
        events: OPS_OPERATION_EVENTS,
        targetId: targetId && targetId.trim() !== '' ? targetId.trim() : null,
        requestId: requestId && requestId.length > 0 ? requestId.slice(0, 128) : null,
        actionEvent: action ? EVENT_BY_ACTION[action] : null,
        since: range.since,
        until: range.until,
      };
      const [total, rows] = await Promise.all([
        countOpsOperations(db, filter),
        listOpsOperations(db, filter, page, pageSize),
      ]);
      const body: OpsOperationList = {
        items: rows.flatMap((row) => {
          const mapped = mapOperation(row);
          return mapped ? [mapped] : [];
        }),
        total,
        page,
        pageSize,
        range,
      };
      return c.json(body);
    }),
  );
}
