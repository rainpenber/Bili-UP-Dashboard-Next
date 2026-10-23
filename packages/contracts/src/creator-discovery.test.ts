import { describe, expect, test } from 'bun:test';
import {
  parseManualPublishEventCreateRequest,
  parseManualPublishedAt,
  parseCreatorPublishEvent,
} from './creator-discovery';
import { formatDynamicDisplayTitle, dynamicTextSummaryFromMetadata } from './monitor';
import { MonitorContractError } from './monitor-targets';

describe('manual publish event contracts', () => {
  test('accepts zoned publishedAt and rejects bare local / future skew', () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    expect(parseManualPublishedAt('2026-08-28T13:29:00+08:00', now)).toBe(
      '2026-08-28T05:29:00.000Z',
    );
    expect(() => parseManualPublishedAt('2026-08-28T13:29:00', now)).toThrow(MonitorContractError);
    expect(() => parseManualPublishedAt('2026-10-23T13:00:00.000Z', now)).toThrow(
      /不能晚于当前时间/,
    );
  });

  test('parses create body with kind-specific externalId rules', () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    expect(
      parseManualPublishEventCreateRequest(
        {
          eventKind: 'dynamic',
          externalId: '1241488471951933462',
          publishedAt: '2026-08-28T13:29:00+08:00',
          title: '抽PS5和GTA6啦!',
        },
        now,
      ),
    ).toEqual({
      eventKind: 'dynamic',
      externalId: '1241488471951933462',
      publishedAt: '2026-08-28T05:29:00.000Z',
      title: '抽PS5和GTA6啦!',
    });
    expect(() =>
      parseManualPublishEventCreateRequest(
        {
          eventKind: 'video',
          externalId: 'not-a-bvid',
          publishedAt: '2026-08-28T13:29:00+08:00',
        },
        now,
      ),
    ).toThrow(/BV/);
  });

  test('parses source manual on publish events', () => {
    const event = parseCreatorPublishEvent({
      id: '11111111-1111-4111-8111-111111111111',
      mid: '496445222',
      eventKind: 'dynamic',
      externalId: '1241488471951933462',
      publishedAt: '2026-08-28T05:29:00.000Z',
      titleSnapshot: '抽PS5和GTA6啦!',
      firstDiscoveredAt: '2026-10-23T12:00:00.000Z',
      source: 'manual',
      monitored: true,
      monitoredTargetId: '22222222-2222-4222-8222-222222222222',
      navigable: false,
    });
    expect(event.source).toBe('manual');
  });
});

describe('dynamic display title', () => {
  test('prefers author + text, then label, then id', () => {
    expect(
      formatDynamicDisplayTitle({
        authorName: 'GOAT前进',
        textSummary: '抽PS5和GTA6啦!',
        targetLabel: 'label',
        dynamicId: '1241488471951933462',
      }),
    ).toBe('GOAT前进 · 抽PS5和GTA6啦!');
    expect(
      formatDynamicDisplayTitle({
        authorName: null,
        textSummary: null,
        targetLabel: '友好标签',
        dynamicId: '1241488471951933462',
      }),
    ).toBe('友好标签');
    expect(
      formatDynamicDisplayTitle({
        authorName: null,
        textSummary: null,
        targetLabel: '1241488471951933462',
        dynamicId: '1241488471951933462',
      }),
    ).toBe('1241488471951933462');
    expect(dynamicTextSummaryFromMetadata({ text: '  抽PS5和GTA6啦!  ' })).toBe('抽PS5和GTA6啦!');
  });
});
