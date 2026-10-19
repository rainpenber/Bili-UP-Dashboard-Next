import { describe, expect, test } from 'bun:test';
import { readCollectorConfig } from '@studio/monitoring';

describe('collector config', () => {
  test('reads bounds and rejects an out-of-range poll', () => {
    const config = readCollectorConfig({
      COLLECTOR_INSTANCE_ID: 'collector-a',
      COLLECTOR_MAX_ATTEMPTS: '2',
    });
    expect(config.instanceId).toBe('collector-a');
    expect(config.maxAttempts).toBe(2);
    expect(() => readCollectorConfig({ COLLECTOR_POLL_MS: '1' })).toThrow(/超出范围/);
  });
});
