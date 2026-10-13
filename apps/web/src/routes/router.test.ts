import { describe, expect, test } from 'bun:test';
import { childRoutePaths } from './route-config';

describe('app routes', () => {
  test('registers monitoring and design-system routes', () => {
    const paths = childRoutePaths();
    expect(paths).toContain('monitoring');
    expect(paths).toContain('design-system');
  });

  test('redirects legacy /monitor to monitoring', () => {
    expect(childRoutePaths()).toContain('monitor');
  });
});
