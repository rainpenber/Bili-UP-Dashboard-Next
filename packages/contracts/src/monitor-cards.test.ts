import { describe, expect, test } from 'bun:test';
import {
  deriveMonitorCardState,
  parseCreateMonitorTargetRequest,
  parseMonitorCard,
  parseMonitorCardIdentity,
  parseMonitorCardListQuery,
  parseMonitorExternalInput,
  parsePinVideoRequest,
  parseVideoBvidParam,
  serializeCreateMonitorTargetRequest,
} from './index';

describe('monitor card contracts', () => {
  test('extracts BV and UID from plain text and standard long links', () => {
    expect(parseMonitorExternalInput('video', ' BV1xx411c7mD ')).toEqual({
      ok: true,
      externalId: 'BV1xx411c7mD',
    });
    expect(
      parseMonitorExternalInput('video', 'https://www.bilibili.com/video/BV1xx411c7mD?p=1'),
    ).toEqual({ ok: true, externalId: 'BV1xx411c7mD' });
    expect(
      parseMonitorExternalInput('video', 'https://m.bilibili.com/video/BV1xx411c7mD/'),
    ).toEqual({ ok: true, externalId: 'BV1xx411c7mD' });
    expect(parseMonitorExternalInput('creator', 'https://space.bilibili.com/12345/video')).toEqual({
      ok: true,
      externalId: '12345',
    });
    expect(parseMonitorExternalInput('creator', 'space.bilibili.com/80486')).toEqual({
      ok: true,
      externalId: '80486',
    });
    expect(parseMonitorExternalInput('dynamic', '12345')).toEqual({
      ok: true,
      externalId: '12345',
    });
    expect(
      parseMonitorExternalInput('dynamic', 'https://t.bilibili.com/966692349750018048?tab=2'),
    ).toEqual({ ok: true, externalId: '966692349750018048' });
    expect(parseMonitorExternalInput('dynamic', 't.bilibili.com/966692349750018048')).toEqual({
      ok: true,
      externalId: '966692349750018048',
    });
    expect(() => parseMonitorCardIdentity('dynamic', '12345')).toThrow(/视频或 UP 主/);
  });

  test('rejects empty input, short links, and the wrong object type without fetching', () => {
    expect(parseMonitorExternalInput('video', '  ').ok).toBe(false);
    const short = parseMonitorExternalInput('video', 'https://b23.tv/BV1xx411c7mD');
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.message).toContain('短链');
    const mismatch = parseMonitorExternalInput('video', 'https://space.bilibili.com/12345');
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.message).toContain('UP 主');
    const av = parseMonitorExternalInput('video', 'https://www.bilibili.com/video/av170001');
    expect(av.ok).toBe(false);
    expect(parseMonitorExternalInput('dynamic', '  ').ok).toBe(false);
    expect(parseMonitorExternalInput('dynamic', '0').ok).toBe(false);
    expect(parseMonitorExternalInput('dynamic', '01').ok).toBe(false);
    expect(parseMonitorExternalInput('dynamic', 'https://b23.tv/abcdef').ok).toBe(false);
    expect(parseMonitorExternalInput('dynamic', 'https://space.bilibili.com/12345').ok).toBe(false);
    expect(
      parseMonitorExternalInput('dynamic', 'https://www.bilibili.com/video/BV1xx411c7mD').ok,
    ).toBe(false);
    expect(parseMonitorExternalInput('video', 'https://t.bilibili.com/12345').ok).toBe(false);
  });

  test('automatic create does not send the legacy 60 minute preset', () => {
    const body = serializeCreateMonitorTargetRequest(
      parseCreateMonitorTargetRequest({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        intervalMode: 'auto',
      }),
    );
    expect(body.intervalMode).toBe('auto');
    expect(body.intervalMinutes).toBeUndefined();
    const fixed = serializeCreateMonitorTargetRequest(
      parseCreateMonitorTargetRequest({
        type: 'creator',
        externalId: '12345',
        intervalMode: 'fixed',
        intervalMinutes: 15,
      }),
    );
    expect(fixed).toMatchObject({ intervalMode: 'fixed', intervalMinutes: 15 });
  });

  test('derives pause and execution without the legacy boolean', () => {
    expect(
      deriveMonitorCardState({
        hasTarget: false,
        enabled: null,
        hasRunning: false,
        hasPending: false,
        lastError: null,
      }).monitorState,
    ).toBe('unmonitored');
    expect(
      deriveMonitorCardState({
        hasTarget: true,
        enabled: true,
        hasRunning: false,
        hasPending: false,
        lastError: '离线失败',
      }),
    ).toEqual({ monitorState: 'active', execution: 'failed' });
    expect(
      deriveMonitorCardState({
        hasTarget: true,
        enabled: false,
        hasRunning: true,
        hasPending: false,
        lastError: null,
      }),
    ).toEqual({ monitorState: 'paused', execution: 'running' });
  });

  test('rejects a card that still carries monitoringEnabled', () => {
    expect(() =>
      parseMonitorCard({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        title: null,
        category: null,
        imageAssetId: null,
        mid: null,
        displayName: 'BV1xx411c7mD',
        hasEntity: true,
        hasSamples: false,
        pinned: false,
        monitorState: 'unmonitored',
        execution: 'none',
        target: null,
        projects: [],
        latest: {
          sampledAt: null,
          viewCount: null,
          onlineViewers: null,
          onlineViewersRaw: null,
          likeCount: null,
          followerCount: null,
        },
        monitoringEnabled: true,
      }),
    ).toThrow(/monitoringEnabled/);
  });

  test('defaults video sort to published_desc and rejects invalid sort', () => {
    expect(parseMonitorCardListQuery({ type: 'video', page: '1', pageSize: '8' }).sort).toBe(
      'published_desc',
    );
    expect(parseMonitorCardListQuery({ type: 'video', page: '1', pageSize: '8' }).onlyMine).toBe(
      false,
    );
    expect(
      parseMonitorCardListQuery({
        type: 'video',
        page: '1',
        pageSize: '8',
        sort: 'published_asc',
      }).sort,
    ).toBe('published_asc');
    expect(
      parseMonitorCardListQuery({
        type: 'video',
        page: '1',
        pageSize: '8',
        onlyMine: '1',
      }).onlyMine,
    ).toBe(true);
    expect(() =>
      parseMonitorCardListQuery({ type: 'video', page: '1', pageSize: '8', sort: 'views' }),
    ).toThrow(/排序/);
    expect(() =>
      parseMonitorCardListQuery({ type: 'video', page: '1', pageSize: '8', onlyMine: 'yes' }),
    ).toThrow(/只看我的/);
  });

  test('creator sort defaults to sampled_desc and rejects video sorts', () => {
    expect(parseMonitorCardListQuery({ type: 'creator', page: '1', pageSize: '8' }).sort).toBe(
      'sampled_desc',
    );
    expect(
      parseMonitorCardListQuery({
        type: 'creator',
        page: '1',
        pageSize: '8',
        sort: 'followers_desc',
      }).sort,
    ).toBe('followers_desc');
    expect(() =>
      parseMonitorCardListQuery({
        type: 'creator',
        page: '1',
        pageSize: '8',
        sort: 'published_desc',
      }),
    ).toThrow(/排序/);
  });

  test('pin body and bvid reuse existing validation', () => {
    expect(parsePinVideoRequest({ pinned: true })).toEqual({ pinned: true });
    expect(() => parsePinVideoRequest({ pinned: 'yes' })).toThrow(/pinned/);
    expect(parseVideoBvidParam('BV1xx411c7mD')).toBe('BV1xx411c7mD');
    expect(() => parseVideoBvidParam('not-a-bvid')).toThrow(/BV/);
  });
});
