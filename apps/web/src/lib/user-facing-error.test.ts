import { describe, expect, test } from 'bun:test';
import { toUserErrorMessage } from '@/lib/user-facing-error';

describe('toUserErrorMessage', () => {
  test('maps English API errors to Chinese', () => {
    expect(toUserErrorMessage(new Error('not found'), '没加载出来')).toBe('没有找到');
    expect(toUserErrorMessage(new Error('bad request'), '没加载出来')).toBe('请求内容不对');
    expect(toUserErrorMessage(new Error('project not found'), '没加载出来')).toBe('找不到这个项目');
    expect(toUserErrorMessage(new Error('HTTP 404'), '没加载出来')).toBe('没有找到');
    expect(toUserErrorMessage(new Error('HTTP 400'), '没加载出来')).toBe('请求内容不对');
    expect(toUserErrorMessage(new Error('HTTP 503'), '没加载出来')).toBe('暂时连不上');
  });

  test('keeps Chinese messages and uses fallback for non-errors', () => {
    expect(toUserErrorMessage(new Error('演示数据暂时读不出来，请稍后重试。'), '没加载出来')).toBe(
      '演示数据暂时读不出来，请稍后重试。',
    );
    expect(toUserErrorMessage('not-an-error', '没加载出来，请再试一次。')).toBe(
      '没加载出来，请再试一次。',
    );
    expect(toUserErrorMessage(new Error('   '), '没加载出来，请再试一次。')).toBe(
      '没加载出来，请再试一次。',
    );
  });
});
