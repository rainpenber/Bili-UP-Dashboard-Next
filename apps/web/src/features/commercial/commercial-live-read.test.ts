import { describe, expect, test } from 'bun:test';
import {
  CommercialReadError,
  fetchLiveProjectDetail,
  fetchLiveProjectList,
} from './commercial-live-api';

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';

const originalFetch = globalThis.fetch;

describe('commercial live read client', () => {
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
