import { describe, expect, test } from 'bun:test';
import { fetchCommercialProjects } from './commercial-mock-api';

describe('commercial mock api', () => {
  test('simulateError throws for demo failure UI', async () => {
    await expect(fetchCommercialProjects({ simulateError: true })).rejects.toThrow(
      '演示数据暂时读不出来',
    );
  });
});
