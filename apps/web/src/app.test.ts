import { describe, expect, test } from 'bun:test';
import { primaryNav } from '@/config/navigation';

describe('web app shell', () => {
  test('navigation marks monitoring and design system as implemented', () => {
    const monitoring = primaryNav.find((n) => n.to === '/monitoring');
    const ds = primaryNav.find((n) => n.to === '/design-system');
    expect(monitoring?.implemented).toBe(true);
    expect(ds?.implemented).toBe(true);
  });

  test('placeholder routes stay unimplemented', () => {
    const projects = primaryNav.find((n) => n.to === '/projects');
    expect(projects?.implemented).toBe(false);
  });
});
