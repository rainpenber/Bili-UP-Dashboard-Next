import { describe, expect, test } from 'bun:test';
import { childRoutePaths } from './route-config';

describe('app routes', () => {
  test('registers monitoring and design-system routes', () => {
    const paths = childRoutePaths();
    expect(paths).toContain('monitoring');
    expect(paths).toContain('monitoring/videos/:bvid');
    expect(paths).toContain('design-system');
    expect(paths).toContain('projects');
    expect(paths).toContain('projects/demo/:projectId');
    expect(paths).toContain('projects/:projectId');
    const demoIndex = paths.indexOf('projects/demo/:projectId');
    const detailIndex = paths.indexOf('projects/:projectId');
    expect(demoIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(demoIndex);
    expect(paths).toContain('integrations');
    expect(paths).toContain('workflow-mock');
  });

  test('redirects legacy /monitor to monitoring', () => {
    expect(childRoutePaths()).toContain('monitor');
  });
});
