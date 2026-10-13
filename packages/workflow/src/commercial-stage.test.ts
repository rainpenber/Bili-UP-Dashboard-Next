import { describe, expect, test } from 'bun:test';
import { postPublishLeavesIncomplete } from './commercial-stage';

describe('commercial stage', () => {
  test('post publish incomplete when settlement open', () => {
    expect(
      postPublishLeavesIncomplete([
        { id: '1', status: 'completed', slug: 'publish' },
        { id: '2', status: 'in_progress', slug: 'settlement' },
      ]),
    ).toBe(true);
  });
});
