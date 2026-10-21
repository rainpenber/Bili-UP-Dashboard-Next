import { describe, expect, test } from 'bun:test';
import {
  formatShanghaiDay,
  opsDefaultRange,
  parseOpsCollectorJobList,
  parseOpsCollectorJobQuery,
  resolveOpsRange,
  shiftShanghaiDay,
} from './ops-records';

const retention = {
  days: 14,
  cutoff: '2026-10-07T00:00:00.000Z',
  oldestStoredAt: null,
  timezone: 'Asia/Shanghai',
};

const range = {
  since: '2026-10-15',
  until: '2026-10-21',
  timezone: 'Asia/Shanghai',
  defaulted: true,
};

describe('ops record contracts', () => {
  test('shanghai day boundaries and the default seven-day window', () => {
    expect(formatShanghaiDay(new Date('2026-10-20T16:00:00.000Z'))).toBe('2026-10-21');
    expect(formatShanghaiDay(new Date('2026-10-20T15:59:59.000Z'))).toBe('2026-10-20');
    expect(shiftShanghaiDay('2026-10-21', -6)).toBe('2026-10-15');
    expect(opsDefaultRange(new Date('2026-10-21T02:00:00.000Z'))).toEqual({
      since: '2026-10-15',
      until: '2026-10-21',
    });
    expect(resolveOpsRange(null, null, new Date('2026-10-21T02:00:00.000Z')).defaulted).toBe(true);
    expect(() => resolveOpsRange('2026-10-22', '2026-10-21')).toThrow(/invalid range/);
    expect(() => resolveOpsRange(null, 'abc')).toThrow(/invalid until/);
    expect(() => resolveOpsRange('2026-02-31', null)).toThrow(/invalid since/);
  });

  test('parses a pending job without inventing a run', () => {
    const query = parseOpsCollectorJobQuery({
      type: 'video',
      status: 'pending',
      group: 'time',
      page: '2',
      pageSize: '500',
    });
    expect(query).toMatchObject({ type: 'video', status: 'pending', page: 2, pageSize: 50 });
    const parsed = parseOpsCollectorJobList({
      mode: 'time',
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          targetId: '22222222-2222-4222-8222-222222222222',
          targetType: 'video',
          externalId: 'BV1xx411c7mD',
          label: '排队',
          displayName: '排队',
          coverUrl: null,
          targetDeleted: false,
          status: 'pending',
          attempts: 0,
          scheduledFor: '2026-10-21T02:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          samplesWritten: null,
          error: null,
          latestAttempt: null,
          projects: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      range,
      logRetention: retention,
    });
    expect(parsed.items[0]?.durationMs).toBeNull();
    expect(parsed.items[0]?.samplesWritten).toBeNull();
    expect(() => parseOpsCollectorJobQuery({ status: 'queued' })).toThrow(/invalid status/);
    expect(parseOpsCollectorJobQuery({ type: 'dynamic' }).type).toBe('dynamic');
    expect(() => parseOpsCollectorJobQuery({ type: 'comment' })).toThrow(/invalid type/);
    const dynamicJob = parseOpsCollectorJobList({
      mode: 'time',
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          targetId: '22222222-2222-4222-8222-222222222222',
          targetType: 'dynamic',
          externalId: '966692349750018048',
          label: '一条动态',
          displayName: '一条动态',
          coverUrl: null,
          targetDeleted: false,
          status: 'pending',
          attempts: 0,
          scheduledFor: '2026-10-21T02:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          samplesWritten: null,
          error: null,
          latestAttempt: null,
          projects: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      range,
      logRetention: retention,
    });
    expect(dynamicJob.items[0]?.targetType).toBe('dynamic');
    expect(dynamicJob.items[0]?.externalId).toBe('966692349750018048');
  });
});
