import { describe, expect, test } from 'bun:test';
import { OVERALL_STAGES, WF_NODE_STATUSES } from './commercial-db';

describe('commercial-db constants', () => {
  test('overall stages match workflow expectations', () => {
    expect(OVERALL_STAGES).toContain('pre_publish');
    expect(WF_NODE_STATUSES).toContain('not_applicable');
  });
});
