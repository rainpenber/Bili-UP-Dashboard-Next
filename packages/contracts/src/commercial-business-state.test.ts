import { describe, expect, test } from 'bun:test';
import {
  KNOWN_SOURCE_DETAIL_STATUSES,
  SOURCE_DETAIL_STATUS_BUSINESS_STATE,
  commercialDisplayStateFromSource,
  deriveCommercialBusinessState,
} from './commercial-business-state';

describe('commercial business state (WP-R2-19C)', () => {
  test('known vocabulary has exactly 13 detail_status labels', () => {
    expect(KNOWN_SOURCE_DETAIL_STATUSES).toHaveLength(13);
    expect(Object.keys(SOURCE_DETAIL_STATUS_BUSINESS_STATE)).toHaveLength(13);
  });

  test('table-driven mapping covers all 13 labels with exact origin text', () => {
    for (const label of KNOWN_SOURCE_DETAIL_STATUSES) {
      const expected = SOURCE_DETAIL_STATUS_BUSINESS_STATE[label];
      const derived = deriveCommercialBusinessState(label);
      expect(derived.businessState).toBe(expected);
      expect(derived.originStatusLabel).toBe(label);
    }
  });

  test('not_started cluster matches the source abandon / not-ready labels', () => {
    const labels = [
      '1.放弃-主动拒绝',
      '1.放弃-未过提报',
      '1.意外终止',
      '1.未开始',
      '0.未确定',
    ] as const;
    for (const label of labels) {
      expect(deriveCommercialBusinessState(label)).toEqual({
        businessState: 'not_started',
        originStatusLabel: label,
      });
    }
  });

  test('finished is only 3.收尾-已提现', () => {
    expect(deriveCommercialBusinessState('3.收尾-已提现')).toEqual({
      businessState: 'finished',
      originStatusLabel: '3.收尾-已提现',
    });
  });

  test('active cluster covers in-progress / wrap-up / parent task', () => {
    const labels = [
      '2.进行中',
      '2.进行中-脚本',
      '2.进行中-拍摄',
      '2.进行中-后期',
      '3.收尾-审核中',
      '3.收尾-上线待结算',
      '母任务',
    ] as const;
    for (const label of labels) {
      expect(deriveCommercialBusinessState(label).businessState).toBe('active');
      expect(deriveCommercialBusinessState(label).originStatusLabel).toBe(label);
    }
  });

  test('unknown status must not be guessed: active + raw label', () => {
    expect(deriveCommercialBusinessState('跟进中')).toEqual({
      businessState: 'active',
      originStatusLabel: '跟进中',
    });
    expect(deriveCommercialBusinessState('已结算')).toEqual({
      businessState: 'active',
      originStatusLabel: '已结算',
    });
    expect(deriveCommercialBusinessState('完全虚构的状态')).toEqual({
      businessState: 'active',
      originStatusLabel: '完全虚构的状态',
    });
  });

  test('null or empty source status keeps a null label and stays active', () => {
    expect(deriveCommercialBusinessState(null)).toEqual({
      businessState: 'active',
      originStatusLabel: null,
    });
    expect(deriveCommercialBusinessState(undefined)).toEqual({
      businessState: 'active',
      originStatusLabel: null,
    });
    expect(deriveCommercialBusinessState('')).toEqual({
      businessState: 'active',
      originStatusLabel: null,
    });
  });

  test('projects without a source binding expose null display state', () => {
    expect(commercialDisplayStateFromSource(null)).toEqual({
      businessState: null,
      originStatusLabel: null,
    });
  });

  test('source-bound projects derive display state only from sourceStatus', () => {
    expect(commercialDisplayStateFromSource({ sourceStatus: '3.收尾-已提现' })).toEqual({
      businessState: 'finished',
      originStatusLabel: '3.收尾-已提现',
    });
    expect(commercialDisplayStateFromSource({ sourceStatus: '1.放弃-主动拒绝' })).toEqual({
      businessState: 'not_started',
      originStatusLabel: '1.放弃-主动拒绝',
    });
    expect(commercialDisplayStateFromSource({ sourceStatus: null })).toEqual({
      businessState: 'active',
      originStatusLabel: null,
    });
  });

  test('mapping ignores name-like or amount-like strings that are not exact labels', () => {
    expect(deriveCommercialBusinessState('树新风').businessState).toBe('active');
    expect(deriveCommercialBusinessState('10000.00').businessState).toBe('active');
    expect(deriveCommercialBusinessState('已提现').businessState).toBe('active');
    expect(deriveCommercialBusinessState('主动拒绝').businessState).toBe('active');
  });
});
