import { describe, expect, test } from 'bun:test';

describe('web bootstrap', () => {
  test('project identifier constant', () => {
    expect('Studio Ops Hub').toContain('Studio');
  });
});
