import { describe, expect, test } from 'bun:test';
import {
  archiveLiveProject,
  CommercialReadError,
  fetchLiveProjectDetail,
  fetchLiveProjectList,
  unarchiveLiveProject,
} from './commercial-live-api';

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';

const originalFetch = globalThis.fetch;

describe('commercial live read client', () => {
  test('sends includeArchived=1 when requested', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ items: [], total: 0, limit: null, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await fetchLiveProjectList({ includeArchived: true, originKind: 'fixture' });
      expect(seen[0]).toContain('includeArchived=1');
      expect(seen[0]).toContain('originKind=fixture');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('archive and unarchive parse archivedAt and keep 404', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: PROJECT_ID, archivedAt: '2026-10-23T12:00:00.000Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(archiveLiveProject(PROJECT_ID)).resolves.toEqual({
        id: PROJECT_ID,
        archivedAt: '2026-10-23T12:00:00.000Z',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: PROJECT_ID, archivedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(unarchiveLiveProject(PROJECT_ID)).resolves.toEqual({
        id: PROJECT_ID,
        archivedAt: null,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'project not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(archiveLiveProject(PROJECT_ID)).rejects.toMatchObject({
        status: 404,
        message: 'project not found',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects a list payload that drops open items', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: PROJECT_ID,
              name: '缺字段',
              netAmount: null,
              rebateAmount: null,
              overallStage: 'pre_publish',
              phase: 'pending',
              currentStageNames: [],
              anyNodeBlocked: false,
              blockingReason: null,
              createdAt: '2026-05-01T00:00:00.000000Z',
              updatedAt: '2026-05-01T00:00:00.000000Z',
              userDeadlineAt: null,
              blockedSinceAt: null,
              archivedAt: null,
              stageEnteredAt: '2026-05-01T00:00:00.000000Z',
              businessClosedAt: null,
              originKind: 'fixture',
              source: null,
              businessState: null,
              originStatusLabel: null,
              sourceWindow: null,
              blockedNodeNames: [],
            },
          ],
          total: 1,
          limit: null,
          offset: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    try {
      await expect(fetchLiveProjectList()).rejects.toBeInstanceOf(CommercialReadError);
      await expect(fetchLiveProjectList()).rejects.toThrow(/openItems/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps 404 and 500 status on the error', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'project not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(fetchLiveProjectDetail(PROJECT_ID)).rejects.toMatchObject({
        status: 404,
        kind: 'http',
        message: 'project not found',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'internal error' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(fetchLiveProjectList()).rejects.toMatchObject({ status: 500, kind: 'http' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
