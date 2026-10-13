import { describe, expect, test } from 'bun:test';
import { buildDashboardBuckets } from './dashboard-build';

const NOW = new Date('2026-06-15T00:00:00.000Z');

describe('dashboard build', () => {
  test('excludes completed overdue nodes', () => {
    const buckets = buildDashboardBuckets(
      [
        {
          id: 'node-1',
          kind: 'node',
          projectId: 'p1',
          projectName: 'P',
          title: 'done',
          issue: 'completed',
          responsibleParty: 'us',
          dueAt: '2026-06-01T00:00:00.000Z',
          suggestedNextStep: 'x',
          focusNodeId: '1',
          focusOpenItemId: null,
          nodeStatus: 'completed',
        },
      ],
      NOW,
    );
    expect(buckets.overdue.length).toBe(0);
  });

  test('waiting us includes open item without due date', () => {
    const buckets = buildDashboardBuckets(
      [
        {
          id: 'item-1',
          kind: 'open_item',
          projectId: 'p1',
          projectName: 'P',
          title: '我方事项',
          issue: 'our_action',
          responsibleParty: 'us',
          dueAt: null,
          suggestedNextStep: '处理',
          focusNodeId: null,
          focusOpenItemId: '1',
          itemType: 'our_action',
          openItemStatus: 'open',
        },
      ],
      NOW,
    );
    expect(buckets.waitingUs.length).toBe(1);
  });

  test('sorts overdue open items by rank then dueAt', () => {
    const buckets = buildDashboardBuckets(
      [
        {
          id: 'a',
          kind: 'open_item',
          projectId: 'p1',
          projectName: 'P',
          title: 'later',
          issue: 'our_action',
          responsibleParty: 'us',
          dueAt: '2026-06-14T12:00:00.000Z',
          suggestedNextStep: 'x',
          focusNodeId: null,
          focusOpenItemId: 'a',
          itemType: 'our_action',
          openItemStatus: 'open',
        },
        {
          id: 'b',
          kind: 'open_item',
          projectId: 'p1',
          projectName: 'P',
          title: 'overdue',
          issue: 'our_action',
          responsibleParty: 'us',
          dueAt: '2026-06-01T00:00:00.000Z',
          suggestedNextStep: 'x',
          focusNodeId: null,
          focusOpenItemId: 'b',
          itemType: 'our_action',
          openItemStatus: 'open',
        },
      ],
      NOW,
    );
    expect(buckets.overdue.length).toBe(2);
    expect(buckets.overdue[0]?.id).toBe('b');
  });
});
