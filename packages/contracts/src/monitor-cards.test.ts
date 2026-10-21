import { describe, expect, test } from 'bun:test';
import {
  deriveMonitorCardState,
  parseCreateMonitorTargetRequest,
  parseMonitorCard,
  parseMonitorCardIdentity,
  parseMonitorExternalInput,
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
    const dynamic = parseMonitorExternalInput('dynamic', '12345');
    expect(dynamic.ok).toBe(false);
    if (!dynamic.ok) expect(dynamic.message).toContain('动态');
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
});
