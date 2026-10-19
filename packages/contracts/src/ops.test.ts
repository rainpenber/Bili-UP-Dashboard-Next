import { describe, expect, test } from 'bun:test';
import {
  decodeOpsCursor,
  encodeOpsCursor,
  parseOpsDebugBundle,
  parseOpsHealth,
  parseOpsLimit,
  parseOpsPage,
  parseOpsRun,
  parseOpsSummary,
} from './ops';

const emptySummary = {
  heartbeats: [],
  queue: { due: 0, running: 0, failed24h: 0 },
  circuits: [],
  targets: [],
  samplesToday: { videos: 0, creators: 0 },
  recentErrorCount: 0,
};

describe('ops contracts', () => {
  test('parses an empty summary and health payload', () => {
    expect(parseOpsSummary(emptySummary)).toEqual(emptySummary);
    expect(
      parseOpsHealth({
        lastHeartbeatAt: null,
        stale: true,
        queueBacklog: 0,
        lastSuccessAt: null,
      }).stale,
    ).toBe(true);
  });

  test('clamps limit and round-trips a cursor', () => {
    expect(parseOpsLimit(undefined)).toBe(50);
    expect(parseOpsLimit('500')).toBe(200);
    expect(() => parseOpsLimit('0')).toThrow('invalid limit');
    const cursor = encodeOpsCursor({ startedAt: '2026-10-19T00:00:00.000Z', id: 'abc' });
    expect(decodeOpsCursor(cursor)).toEqual({ startedAt: '2026-10-19T00:00:00.000Z', id: 'abc' });
    expect(() => decodeOpsCursor('@@@')).toThrow('invalid cursor');
  });

  test('parses a populated run page and a bundle with null relations', () => {
    const run = {
      id: '11111111-1111-4111-8111-111111111111',
      targetId: '22222222-2222-4222-8222-222222222222',
      targetLabel: '离线视频',
      status: 'succeeded',
      samplesWritten: 1,
      durationMs: 12,
      error: null,
      startedAt: '2026-10-19T00:00:00.000Z',
      finishedAt: '2026-10-19T00:00:01.000Z',
    };
    const page = parseOpsPage({ items: [run], nextCursor: null, limit: 50 }, parseOpsRun, 'runs');
    expect(page.items[0]?.targetLabel).toBe('离线视频');
    const bundle = parseOpsDebugBundle({
      schemaVersion: '007_metadata_assets_logs',
      generatedAt: '2026-10-19T00:00:02.000Z',
      run,
      target: null,
      requests: [],
      logs: [],
      video: null,
      creator: null,
      heartbeats: [],
      circuits: [],
    });
    expect(bundle.run?.id).toBe(run.id);
    expect(bundle.video).toBeNull();
  });
});
