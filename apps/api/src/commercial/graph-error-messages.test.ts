import { describe, expect, test } from 'bun:test';
import { graphErrorMessage } from './graph-error-messages';

describe('graphErrorMessage', () => {
  test('maps cycle detected to Chinese', () => {
    expect(graphErrorMessage('cycle detected')).toBe('连线会形成环路，已拒绝');
  });
});
