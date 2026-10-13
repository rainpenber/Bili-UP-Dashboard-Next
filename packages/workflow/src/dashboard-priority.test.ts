import { describe, expect, test } from 'bun:test';
import { rankDashboardItems } from './dashboard-priority';

describe('dashboard priority', () => {
  test('overdue ranks before ordinary due items', () => {
    const ranked = rankDashboardItems([
      {
        id: 'a',
        kind: 'node_due',
        projectId: 'p1',
        dueAt: '2026-06-20T00:00:00.000Z',
        isOverdue: false,
        isBlocked: false,
        blockedDownstreamCount: 0,
        waitingParty: null,
        waitingExternalHours: 0,
        publishWithinDays: null,
      },
      {
        id: 'b',
        kind: 'open_item',
        projectId: 'p2',
        dueAt: '2026-06-01T00:00:00.000Z',
        isOverdue: true,
        isBlocked: false,
        blockedDownstreamCount: 0,
        waitingParty: 'us',
        waitingExternalHours: 0,
        publishWithinDays: null,
      },
    ]);
    expect(ranked[0]!.id).toBe('b');
    expect(ranked[0]!.sortReasons).toContain('已逾期');
    expect(ranked[0]!.explanation).toBeTruthy();
  });
});
