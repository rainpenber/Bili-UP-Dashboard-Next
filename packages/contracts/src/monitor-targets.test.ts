import { describe, expect, test } from 'bun:test';
import {
  MonitorContractError,
  parseCreateMonitorTargetRequest,
  parsePatchMonitorTargetRequest,
  splitTagInput,
} from './monitor-targets';

describe('monitor target contracts', () => {
  test('accepts a BV and a UID with defaults', () => {
    const video = parseCreateMonitorTargetRequest({
      type: 'video',
      externalId: ' BV1xx411c7mD ',
      tags: ['春季', 'spring'],
    });
    expect(video.externalId).toBe('BV1xx411c7mD');
    expect(video.label).toBe('BV1xx411c7mD');
    expect(video.intervalMinutes).toBe(60);
    expect(video.tags).toEqual(['春季', 'spring']);

    const creator = parseCreateMonitorTargetRequest({
      type: 'creator',
      externalId: '12345',
      label: '测试 UP',
      intervalMinutes: 15,
    });
    expect(creator.externalId).toBe('12345');
    expect(creator.intervalMinutes).toBe(15);
  });

  test('rejects illegal BV, UID, interval, and unknown fields', () => {
    expect(() =>
      parseCreateMonitorTargetRequest({ type: 'video', externalId: 'BVTEST001' }),
    ).toThrow(MonitorContractError);
    try {
      parseCreateMonitorTargetRequest({ type: 'video', externalId: 'BVTEST001' });
    } catch (err) {
      expect(err).toBeInstanceOf(MonitorContractError);
      expect((err as MonitorContractError).code).toBe('invalid_external_id');
      expect((err as MonitorContractError).message).toContain('BV');
    }
    expect(() => parseCreateMonitorTargetRequest({ type: 'creator', externalId: '0123' })).toThrow(
      /UID/,
    );
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        intervalMinutes: 7,
      }),
    ).toThrow(/频率/);
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        note: 'nope',
      }),
    ).toThrow(/不能识别/);
  });

  test('patch requires a known field', () => {
    expect(parsePatchMonitorTargetRequest({ enabled: false }).enabled).toBe(false);
    expect(() => parsePatchMonitorTargetRequest({})).toThrow(/没有可更新/);
  });

  test('splits tag input on commas and spaces', () => {
    expect(splitTagInput(' 春季， 活动  beta ')).toEqual(['春季', '活动', 'beta']);
  });
});
