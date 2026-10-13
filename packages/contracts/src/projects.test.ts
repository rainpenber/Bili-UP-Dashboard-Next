import { describe, expect, test } from 'bun:test';
import { createProjectBodySchema, projectListQuerySchema } from './projects';

describe('projects contracts', () => {
  test('create project body requires name', () => {
    expect(() => createProjectBodySchema.parse({})).toThrow();
    const parsed = createProjectBodySchema.parse({ name: '测试商单' });
    expect(parsed.name).toBe('测试商单');
  });

  test('list query defaults page size', () => {
    const parsed = projectListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.includeArchived).toBe(false);
  });
});
