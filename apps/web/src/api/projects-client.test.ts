import { describe, expect, test } from 'bun:test';
import { projectSummarySchema } from '@studio/contracts';

describe('projects client response parsing', () => {
  test('rejects malformed project summary', () => {
    expect(() => projectSummarySchema.parse({ id: 'not-uuid', name: 'x' })).toThrow();
  });
});
