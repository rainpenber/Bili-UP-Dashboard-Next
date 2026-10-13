import { describe, expect, test } from 'bun:test';
import { primaryNav } from '@/config/navigation';

describe('web app shell', () => {
  test('navigation marks monitoring and design system as implemented', () => {
    const monitoring = primaryNav.find((n) => n.to === '/monitoring');
    const ds = primaryNav.find((n) => n.to === '/design-system');
    expect(monitoring?.implemented).toBe(true);
    expect(ds?.implemented).toBe(true);
  });

  test('projects and today dashboard are implemented', () => {
    const projects = primaryNav.find((n) => n.to === '/projects');
    const today = primaryNav.find((n) => n.to === '/');
    expect(projects?.implemented).toBe(true);
    expect(today?.implemented).toBe(true);
  });
});
