import { describe, expect, test } from 'bun:test';
import {
  createProjectBodySchema,
  dashboardTodayResponseSchema,
  patchOpenItemBodySchema,
  projectListQuerySchema,
} from './projects';

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

  test('patch open item rejects confirmedById without humanConfirmed', () => {
    expect(() =>
      patchOpenItemBodySchema.parse({ confirmedById: '33333333-3333-4333-8333-333333333333' }),
    ).toThrow();
  });

  test('dashboard response rejects malformed bucket entry', () => {
    expect(() =>
      dashboardTodayResponseSchema.parse({
        generatedAt: '2026-06-15T00:00:00.000Z',
        overdue: [{ id: 'x', kind: 'not-a-kind' }],
        dueToday: [],
        dueNext7Days: [],
        blockedProjects: [],
        waitingClient: [],
        waitingUs: [],
        pendingConfirmation: [],
      }),
    ).toThrow();
  });
});
