import { describe, expect, test } from 'bun:test';
import {
  createProjectBodySchema,
  dashboardTodayResponseSchema,
  hermesProposalBodySchema,
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

  test('patch open item rejects humanConfirmed false with confirmedById', () => {
    expect(() =>
      patchOpenItemBodySchema.parse({
        humanConfirmed: false,
        confirmedById: '33333333-3333-4333-8333-333333333333',
      }),
    ).toThrow();
  });

  test('hermes create_open_item rejects confirmed without confirmer', () => {
    expect(() =>
      hermesProposalBodySchema.parse({
        projectId: 'aaaaaaaa-0001-4001-8001-000000000001',
        idempotencyKey: 'k1',
        suggestedAction: 'create_open_item',
        payload: {
          action: 'create_open_item',
          itemType: 'confirmation',
          title: 'x',
          responsibleParty: 'us',
          humanConfirmed: true,
        },
        confidence: 0.1,
      }),
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
