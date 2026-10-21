import { describe, expect, test } from 'bun:test';
import { monitorTargetLabel, monitorTargetMark } from './ops-format';
import { readOpsView } from './ops-state';

describe('ops dynamic labels', () => {
  test('keeps a dynamic filter and does not label it as a creator', () => {
    const view = readOpsView(
      new URLSearchParams('type=dynamic&targetType=dynamic&externalId=966692349750018048'),
    );
    expect(view.type).toBe('dynamic');
    expect(view.targetType).toBe('dynamic');
    expect(view.externalId).toBe('966692349750018048');
    expect(monitorTargetLabel('dynamic')).toBe('动态');
    expect(monitorTargetMark('dynamic')).toBe('动态');
    expect(monitorTargetLabel('video')).toBe('视频');
    expect(monitorTargetLabel('creator')).toBe('UP 主');
    expect(monitorTargetMark('video')).toBe('BV');
    expect(monitorTargetMark('creator')).toBe('UP');
  });
});
