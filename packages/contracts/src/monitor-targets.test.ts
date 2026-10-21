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
    expect(video.intervalMode).toBe('auto');
    expect(video.tags).toEqual(['春季', 'spring']);

    const creator = parseCreateMonitorTargetRequest({
      type: 'creator',
      externalId: '12345',
      label: '测试 UP',
      intervalMinutes: 15,
    });
    expect(creator.externalId).toBe('12345');
    expect(creator.intervalMinutes).toBe(15);
    expect(creator.intervalMode).toBe('auto');

    const defaultCreator = parseCreateMonitorTargetRequest({
      type: 'creator',
      externalId: '240',
    });
    expect(defaultCreator.intervalMinutes as number).toBe(240);
    expect(defaultCreator.intervalMode).toBe('auto');

    const fixed = parseCreateMonitorTargetRequest({
      type: 'video',
      externalId: 'BV1xx411c7mD',
      intervalMinutes: 120,
      intervalMode: 'fixed',
    });
    expect(fixed.intervalMinutes as number).toBe(120);
    expect(fixed.intervalMode).toBe('fixed');
    expect(
      parseCreateMonitorTargetRequest({
        type: 'creator',
        externalId: '7',
        intervalMinutes: 7,
        intervalMode: 'fixed',
      }).intervalMinutes as number,
    ).toBe(7);
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
        intervalMinutes: 4,
      }),
    ).toThrow(/频率/);
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        intervalMinutes: 10081,
      }),
    ).toThrow(/频率/);
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'creator',
        externalId: '12345',
        intervalMode: 'weekly',
      }),
    ).toThrow(/自动或固定/);
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
    expect(parsePatchMonitorTargetRequest({ intervalMinutes: 240, intervalMode: 'fixed' })).toEqual(
      { intervalMinutes: 240, intervalMode: 'fixed' },
    );
    expect(() => parsePatchMonitorTargetRequest({})).toThrow(/没有可更新/);
    expect(() => parsePatchMonitorTargetRequest({ intervalMinutes: 3 })).toThrow(/频率/);
  });

  test('dynamic ids stay strings on a fixed 60 minute default and reject auto', () => {
    const created = parseCreateMonitorTargetRequest({
      type: 'dynamic',
      externalId: ' 966692349750018048 ',
    });
    expect(created).toMatchObject({
      type: 'dynamic',
      externalId: '966692349750018048',
      intervalMode: 'fixed',
      intervalMinutes: 60,
    });
    expect(typeof created.externalId).toBe('string');
    const longId = '9'.repeat(25);
    expect(
      parseCreateMonitorTargetRequest({ type: 'dynamic', externalId: longId }).externalId,
    ).toBe(longId);
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'dynamic',
        externalId: longId,
        intervalMode: 'auto',
      }),
    ).toThrow(/固定间隔/);
    for (const externalId of ['0', '01', 'BV1xx411c7mD', '12.5', '']) {
      expect(() => parseCreateMonitorTargetRequest({ type: 'dynamic', externalId })).toThrow(
        /十进制/,
      );
    }
    expect(() =>
      parseCreateMonitorTargetRequest({
        type: 'dynamic',
        externalId: '12345',
        intervalMinutes: 4,
        intervalMode: 'fixed',
      }),
    ).toThrow(/频率/);
    expect(
      parseCreateMonitorTargetRequest({ type: 'video', externalId: 'BV1xx411c7mD' }).intervalMode,
    ).toBe('auto');
    expect(
      parseCreateMonitorTargetRequest({ type: 'creator', externalId: '240' })
        .intervalMinutes as number,
    ).toBe(240);
  });

  test('splits tag input on commas and spaces', () => {
    expect(splitTagInput(' 春季， 活动  beta ')).toEqual(['春季', '活动', 'beta']);
  });
});
