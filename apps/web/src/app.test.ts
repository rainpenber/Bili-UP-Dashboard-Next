import { describe, expect, test } from 'bun:test';
import { primaryNav } from '@/config/navigation';

describe('web app shell', () => {
  test('navigation marks monitoring and design system as implemented', () => {
    const monitoring = primaryNav.find((n) => n.to === '/monitoring');
    const ds = primaryNav.find((n) => n.to === '/design-system');
    expect(monitoring?.implemented).toBe(true);
    expect(ds?.implemented).toBe(true);
  });

  test('commercial surfaces are implemented', () => {
    const home = primaryNav.find((n) => n.to === '/');
    const projects = primaryNav.find((n) => n.to === '/projects');
    const integrations = primaryNav.find((n) => n.to === '/integrations');
    expect(home?.implemented).toBe(true);
    expect(projects?.implemented).toBe(true);
    expect(integrations?.implemented).toBe(true);
  });

  test('audience reaction tool is implemented under /content', () => {
    const content = primaryNav.find((n) => n.to === '/content');
    expect(content?.implemented).toBe(true);
    expect(content?.label).toBe('观众反应模拟');
  });
});
