import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from './mock-data';
import {
  filterProjects,
  getBlockedProjectSummaries,
  getOurActionItems,
  sortProjectsForList,
} from './commercial-selectors';

describe('commercial selectors', () => {
  test('sorts blocked-with-reason before in-progress', () => {
    const sorted = sortProjectsForList(commercialProjectsMock);
    const firstBlockedIdx = sorted.findIndex((p) => p.listBucket === 'blocked_with_reason');
    const firstProgressIdx = sorted.findIndex((p) => p.listBucket === 'in_progress');
    expect(firstBlockedIdx).toBeGreaterThanOrEqual(0);
    expect(firstProgressIdx).toBeGreaterThan(firstBlockedIdx);
  });

  test('home our-items include outline ping-pong as single row', () => {
    const ours = getOurActionItems(commercialProjectsMock);
    const nevItems = ours.filter((i) => i.projectId === 'proj-nev-spring');
    expect(nevItems).toHaveLength(1);
    expect(nevItems[0]?.title).toContain('大纲');
  });

  test('blocked summaries need concrete block fields', () => {
    const rows = getBlockedProjectSummaries(commercialProjectsMock);
    expect(rows.some((r) => r.projectId === 'proj-nev-spring')).toBe(true);
    expect(rows.every((r) => r.blockedDays > 0)).toBe(true);
  });

  test('keyword filter matches brand haystack', () => {
    const filtered = filterProjects(commercialProjectsMock, {
      keyword: '露营',
      fromDate: '',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('proj-camp-gear');
  });
});
