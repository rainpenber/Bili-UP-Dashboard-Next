import { describe, expect, test } from 'bun:test';
import type { CommercialProjectListItem } from '@studio/contracts';
import { blockedProjects, listProjects, movingProjects } from './commercial-selectors';

function item(
  patch: Partial<CommercialProjectListItem> & Pick<CommercialProjectListItem, 'id' | 'name'>,
): CommercialProjectListItem {
  return {
    netAmount: null,
    rebateAmount: null,
    overallStage: 'pre_publish',
    currentStageNames: [],
    anyNodeBlocked: false,
    ...patch,
  };
}

describe('commercial list selectors', () => {
  const projects = [
    item({ id: 'a', name: '大纲方向', currentStageNames: ['大纲'], anyNodeBlocked: false }),
    item({
      id: 'b',
      name: '甲方卡文案',
      currentStageNames: ['文案', '预拍摄'],
      anyNodeBlocked: true,
    }),
    item({
      id: 'c',
      name: '已归档',
      overallStage: 'archived',
      currentStageNames: ['结算'],
      anyNodeBlocked: false,
    }),
  ];

  test('sorts blocked projects ahead of the others', () => {
    const sorted = listProjects(projects, '');
    expect(sorted[0]?.id).toBe('b');
    expect(sorted.findIndex((project) => project.id === 'c')).toBeGreaterThan(0);
  });

  test('keyword matches the project name and the current node names', () => {
    expect(listProjects(projects, '预拍摄').map((project) => project.id)).toEqual(['b']);
    expect(listProjects(projects, '归档')).toHaveLength(1);
  });

  test('home groups use the blocked flag from the list endpoint', () => {
    expect(blockedProjects(projects).map((project) => project.id)).toEqual(['b']);
    expect(movingProjects(projects).map((project) => project.id)).toEqual(['a']);
  });
});
