import {
  findActivePublishMonitorTargetId,
  getCreatorDynamicsSyncState,
  insertCreatorPublishEvent,
  upsertCreatorDynamicsSyncState,
  type Sql,
} from '@studio/db';
import { BilibiliFailure, type UpstreamCall } from './bilibili-failure';
import type { ParsedSpaceDynamic } from './bilibili-discovery-parse';
import { resolveDiscoveryDynamicTitle } from './bilibili-discovery-parse';
import { scrubCollectorError } from './credentials';

/** Keep in sync with packages/contracts CREATOR_DYNAMICS_SYNC_*. */
export const CREATOR_DYNAMICS_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
export const CREATOR_DYNAMICS_SYNC_MAX_ITEMS = 30;
export const CREATOR_DYNAMICS_SYNC_MAX_PAGES = 2;

export type CreatorDynamicsSyncStatus = {
  mid: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  dynamicCount: number;
  eventsCreated: number;
  stale: boolean;
  ttlMs: number;
};

export type CreatorDynamicsSyncResponse = CreatorDynamicsSyncStatus & {
  cached: boolean;
  pagesFetched: number;
  createdCount: number;
};

export type CreatorDynamicsPageProvider = {
  fetchCreatorDynamics(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
    offset?: string | null;
  }): Promise<{
    dynamics: ParsedSpaceDynamic[];
    skips?: { externalId: string; reason: string }[];
    calls: UpstreamCall[];
    offset?: string | null;
    hasMore?: boolean;
  }>;
};

export type CreatorDynamicsSyncEffects = {
  resolveAccount(input: {
    targetAccountId: string | null;
    forcedAccountId: string | null;
  }): Promise<{ id: string; status: string } | null>;
  cookieHeaderFor(accountId: string): Promise<string | null>;
  audit(input: {
    accountId: string | null;
    runId: string | null;
    calls: UpstreamCall[];
  }): Promise<void>;
};

function toStatus(
  mid: string,
  state: {
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastDynamicCount: number;
    lastEventsCreated: number;
  } | null,
  now: Date,
): CreatorDynamicsSyncStatus {
  const lastSyncedAt = state?.lastSyncedAt ?? null;
  const stale =
    lastSyncedAt === null || now.getTime() - lastSyncedAt.getTime() >= CREATOR_DYNAMICS_SYNC_TTL_MS;
  return {
    mid,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    dynamicCount: state?.lastDynamicCount ?? 0,
    eventsCreated: state?.lastEventsCreated ?? 0,
    stale,
    ttlMs: CREATOR_DYNAMICS_SYNC_TTL_MS,
  };
}

export async function readCreatorDynamicsSyncStatus(
  sql: Sql,
  mid: string,
  now = new Date(),
): Promise<CreatorDynamicsSyncStatus> {
  const state = await getCreatorDynamicsSyncState(sql, mid);
  return toStatus(mid, state, now);
}

async function persistDynamicEvents(
  sql: Sql,
  input: { mid: string; now: Date; dynamics: ParsedSpaceDynamic[] },
): Promise<{ dynamicCount: number; eventsCreated: number }> {
  let eventsCreated = 0;
  const seen = new Set<string>();
  for (const dyn of input.dynamics) {
    if (seen.has(dyn.dynamicId)) continue;
    seen.add(dyn.dynamicId);
    const publishedAt = new Date(Number(dyn.publishedAtSec) * 1000);
    const titleSnapshot = resolveDiscoveryDynamicTitle({
      title: dyn.title,
      text: dyn.text ?? null,
      dynamicId: dyn.dynamicId,
    }).slice(0, 40);
    const existingTargetId = await findActivePublishMonitorTargetId(sql, {
      eventKind: 'dynamic',
      externalId: dyn.dynamicId,
    });
    const inserted = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: input.mid,
      eventKind: 'dynamic',
      externalId: dyn.dynamicId,
      publishedAt,
      titleSnapshot: titleSnapshot || `动态 ${dyn.dynamicId.slice(-6)}`,
      firstDiscoveredAt: input.now,
      monitoredTargetId: existingTargetId,
      source: 'bilibili',
    });
    if (inserted.created) eventsCreated += 1;
  }
  return { dynamicCount: seen.size, eventsCreated };
}

/**
 * Sync recent dynamics into creator_publish_events (event_kind=dynamic).
 * Max 30 items / 2 pages. TTL 6h unless force. Never creates monitor targets.
 * Does not overwrite manual events (insertCreatorPublishEvent is idempotent by mid+kind+id).
 */
export async function syncCreatorDynamics(options: {
  sql: Sql;
  mid: string;
  force: boolean;
  provider: CreatorDynamicsPageProvider;
  effects: CreatorDynamicsSyncEffects;
  forcedAccountId: string | null;
  now?: Date;
}): Promise<CreatorDynamicsSyncResponse> {
  const now = options.now ?? new Date();
  const status = await readCreatorDynamicsSyncStatus(options.sql, options.mid, now);
  if (!options.force && !status.stale && status.lastSyncedAt) {
    return {
      ...status,
      cached: true,
      pagesFetched: 0,
      createdCount: status.eventsCreated,
    };
  }

  const account = await options.effects.resolveAccount({
    targetAccountId: null,
    forcedAccountId: options.forcedAccountId,
  });
  let cookie: string | null = null;
  if (account) {
    try {
      cookie = await options.effects.cookieHeaderFor(account.id);
    } catch (error) {
      const message = scrubCollectorError(error);
      await upsertCreatorDynamicsSyncState(options.sql, {
        mid: options.mid,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        lastError: message,
        lastDynamicCount: status.dynamicCount,
        lastEventsCreated: status.eventsCreated,
        now,
      });
      throw new BilibiliFailure({
        message,
        kind: 'retryable',
        endpoint: 'space_dynamic_feed',
        statusCode: null,
        bizCode: null,
        calls: [],
      });
    }
  }

  const calls: UpstreamCall[] = [];
  const collected: ParsedSpaceDynamic[] = [];
  let pagesFetched = 0;
  let offset: string | null = null;
  try {
    for (let page = 1; page <= CREATOR_DYNAMICS_SYNC_MAX_PAGES; page += 1) {
      if (collected.length >= CREATOR_DYNAMICS_SYNC_MAX_ITEMS) break;
      const feed = await options.provider.fetchCreatorDynamics({
        mid: options.mid,
        cookieHeader: cookie,
        accountKey: account?.id ?? 'anonymous',
        offset,
      });
      calls.push(...feed.calls);
      pagesFetched += 1;
      if (feed.dynamics.length === 0) break;
      for (const item of feed.dynamics) {
        if (collected.length >= CREATOR_DYNAMICS_SYNC_MAX_ITEMS) break;
        collected.push(item);
      }
      if (!feed.hasMore || !feed.offset) break;
      offset = feed.offset;
    }
  } catch (error) {
    const message = scrubCollectorError(error);
    const failure =
      error instanceof BilibiliFailure
        ? error
        : new BilibiliFailure({
            message,
            kind: 'retryable',
            endpoint: 'space_dynamic_feed',
            statusCode: null,
            bizCode: null,
            calls,
          });
    await options.effects.audit({
      accountId: account?.id ?? null,
      runId: null,
      calls: failure.calls.length > 0 ? failure.calls : calls,
    });
    await upsertCreatorDynamicsSyncState(options.sql, {
      mid: options.mid,
      lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
      lastError: message,
      lastDynamicCount: status.dynamicCount,
      lastEventsCreated: status.eventsCreated,
      now,
    });
    throw failure;
  }

  const written = await persistDynamicEvents(options.sql, {
    mid: options.mid,
    now,
    dynamics: collected,
  });
  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: null,
    calls,
  });
  const saved = await upsertCreatorDynamicsSyncState(options.sql, {
    mid: options.mid,
    lastSyncedAt: now,
    lastError: null,
    lastDynamicCount: written.dynamicCount,
    lastEventsCreated: written.eventsCreated,
    now,
  });
  return {
    mid: options.mid,
    cached: false,
    lastSyncedAt: saved.lastSyncedAt?.toISOString() ?? now.toISOString(),
    lastError: null,
    dynamicCount: written.dynamicCount,
    eventsCreated: written.eventsCreated,
    createdCount: written.eventsCreated,
    pagesFetched,
    stale: false,
    ttlMs: CREATOR_DYNAMICS_SYNC_TTL_MS,
  };
}
