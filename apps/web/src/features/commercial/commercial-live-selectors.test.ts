import { describe, expect, test } from 'bun:test';
import type { CommercialOpenItemRead, CommercialProjectListItem } from '@studio/contracts';
import {
  countLiveOpenActions,
  excludeSoftArchivedProjects,
  filterLiveProjects,
  getLiveActiveProjects,
  getLiveBlockedSummaries,
  getLiveClientActionItems,
  getLiveOurActionItems,
  onlySoftArchivedProjects,
  sortLiveProjects,
} from './commercial-live-selectors';

const ITEM = 'f0a10001-0001-4001-8001-0000000000a1';

function item(overrides: Partial<CommercialOpenItemRead> = {}): CommercialOpenItemRead {
  return {
    id: ITEM,
    title: '跟进大纲',
    description: null,
    closeCriteria: null,
    nextAction: '发一版结构',
    nextActor: 'us',
    lifecycle: 'open',
    impact: 'normal',
    plannedAt: null,
    sortRank: 0,
    blocksRequiredForClose: false,
    workflowNodeId: null,
    blocksNodeId: null,
    createdAt: '2026-05-02T00:00:00.000000Z',
    updatedAt: '2026-05-02T00:00:00.000000Z',
    ...overrides,
  };
}

function project(
  id: string,
  overrides: Partial<CommercialProjectListItem> = {},
): CommercialProjectListItem {
  return {
    id,
    name: id,
    netAmount: null,
    rebateAmount: null,
    overallStage: 'pre_publish',
    currentStageNames: [],
    anyNodeBlocked: false,
    blockingReason: null,
    createdAt: '2026-05-01T00:00:00.000000Z',
    updatedAt: '2026-05-01T00:00:00.000000Z',
    userDeadlineAt: null,
    blockedSinceAt: null,
    archivedAt: null,
    stageEnteredAt: '2026-05-01T00:00:00.000000Z',
    businessClosedAt: null,
    originKind: 'fixture',
    source: null,
    businessState: null,
    originStatusLabel: null,
    sourceWindow: null,
    blockedNodeNames: [],
    openItems: [],
    ...overrides,
  };
}

const OURS = 'f0010001-0001-4001-8001-000000000001';
const CLIENT = 'f0010001-0001-4001-8001-000000000002';
const ARCHIVED = 'f0010001-0001-4001-8001-000000000006';
const BLOCKED = 'f0010001-0001-4001-8001-000000000007';

describe('live commercial selectors', () => {
  const projects = [
    project(OURS, {
      name: '大纲样例',
      createdAt: '2026-05-01T02:00:00.000000Z',
      openItems: [item({ plannedAt: null })],
    }),
    project(CLIENT, {
      name: '甲方样例',
      createdAt: '2026-05-03T02:00:00.000000Z',
      openItems: [
        item({
          id: 'f0a10001-0001-4001-8001-0000000000a2',
          title: '等甲方确认',
          nextActor: 'client',
          impact: 'blocking',
          plannedAt: null,
          nextAction: null,
        }),
        item({
          id: 'f0a10001-0001-4001-8001-0000000000a3',
          title: '已关闭核对',
          lifecycle: 'closed',
          nextActor: 'client',
        }),
      ],
    }),
    project(ARCHIVED, {
      name: '归档样例',
      overallStage: 'archived',
      archivedAt: '2026-01-15T00:00:00.000000Z',
      anyNodeBlocked: true,
      blockedNodeNames: ['结算'],
      blockingReason: null,
      userDeadlineAt: null,
      blockedSinceAt: null,
      openItems: [item({ id: 'f0a10001-0001-4001-8001-0000000000a9', title: '归档后不应进待办' })],
    }),
    project(BLOCKED, {
      name: '无原因阻塞',
      createdAt: '2026-04-01T00:00:00.000000Z',
      anyNodeBlocked: true,
      blockedNodeNames: [],
      blockingReason: null,
      currentStageNames: [],
    }),
  ];

  test('splits open items by actor and keeps undated rows', () => {
    const ours = getLiveOurActionItems(projects);
    expect(ours.map((row) => row.projectId)).toEqual([OURS]);
    expect(ours[0]?.plannedAt).toBeNull();
    const client = getLiveClientActionItems(projects);
    expect(client).toHaveLength(1);
    expect(client[0]?.title).toBe('等甲方确认');
    expect(client[0]?.nextAction).toBeNull();
    expect(client[0]?.plannedAt).toBeNull();
  });

  test('soft-archived projects stay out of dashboard action and blocked modules', () => {
    expect(getLiveOurActionItems(projects).some((row) => row.projectId === ARCHIVED)).toBe(false);
    expect(getLiveClientActionItems(projects).some((row) => row.projectId === ARCHIVED)).toBe(
      false,
    );
    const blocked = getLiveBlockedSummaries(projects);
    expect(blocked.find((row) => row.projectId === ARCHIVED)).toBeUndefined();
    const bare = blocked.find((row) => row.projectId === BLOCKED);
    expect(bare).toMatchObject({
      blockingReason: null,
      userDeadlineAt: null,
      blockedNodeNames: [],
    });
    expect(excludeSoftArchivedProjects(projects).map((row) => row.id)).not.toContain(ARCHIVED);
    expect(onlySoftArchivedProjects(projects).map((row) => row.id)).toEqual([ARCHIVED]);
  });

  test('keyword uses stored names and items, and the date filter uses created_at', () => {
    expect(
      filterLiveProjects(projects, { keyword: '等甲方', fromDate: '' }).map((row) => row.id),
    ).toEqual([CLIENT]);
    expect(filterLiveProjects(projects, { keyword: '某品牌', fromDate: '' })).toHaveLength(0);
    const dated = filterLiveProjects(projects, { keyword: '', fromDate: '2026-05-02' });
    expect(dated.map((row) => row.id)).toEqual([CLIENT]);
  });

  test('sorts a reasoned block ahead of a reasonless block and archived last', () => {
    const reasoned = project('f0010001-0001-4001-8001-000000000008', {
      anyNodeBlocked: true,
      blockingReason: '等素材',
      blockedNodeNames: ['文案'],
      createdAt: '2026-01-01T00:00:00.000000Z',
    });
    const sorted = sortLiveProjects([projects[3]!, projects[2]!, reasoned, projects[0]!]);
    expect(sorted.map((row) => row.id)).toEqual([reasoned.id, BLOCKED, OURS, ARCHIVED]);
  });

  test('active projects appear without openItems; not_started/finished/archived stay out', () => {
    const activeA = project('f0010001-0001-4001-8001-0000000000a1', {
      name: '真实进行中甲',
      businessState: 'active',
      originStatusLabel: '2.进行中',
      currentStageNames: ['文案'],
      openItems: [],
      createdAt: '2026-06-02T00:00:00.000000Z',
    });
    const activeB = project('f0010001-0001-4001-8001-0000000000a2', {
      name: '真实进行中乙',
      businessState: 'active',
      originStatusLabel: '3.收尾-审核中',
      currentStageNames: [],
      overallStage: 'pre_publish',
      openItems: [],
      createdAt: '2026-06-01T00:00:00.000000Z',
    });
    const notStarted = project('f0010001-0001-4001-8001-0000000000a3', {
      name: '未开始',
      businessState: 'not_started',
      originStatusLabel: '1.未开始',
      openItems: [],
    });
    const finished = project('f0010001-0001-4001-8001-0000000000a4', {
      name: '已提现',
      businessState: 'finished',
      originStatusLabel: '3.收尾-已提现',
      openItems: [],
    });
    const archivedActive = project('f0010001-0001-4001-8001-0000000000a5', {
      name: '归档样例不该出现',
      businessState: 'active',
      originStatusLabel: '2.进行中',
      archivedAt: '2026-01-01T00:00:00.000000Z',
      overallStage: 'archived',
      openItems: [],
    });
    const unbound = project('f0010001-0001-4001-8001-0000000000a6', {
      name: '无业务态',
      businessState: null,
      openItems: [],
    });

    const rows = getLiveActiveProjects([
      finished,
      activeB,
      archivedActive,
      notStarted,
      activeA,
      unbound,
    ]);
    expect(rows.map((row) => row.projectId)).toEqual([activeA.id, activeB.id]);
    expect(rows.every((row) => row.businessState === 'active')).toBe(true);
    expect(rows[0]).toMatchObject({
      projectName: '真实进行中甲',
      progressLabel: '文案',
      originStatusLabel: '2.进行中',
    });
    expect(rows[1]).toMatchObject({
      projectName: '真实进行中乙',
      progressLabel: '发布前',
      originStatusLabel: '3.收尾-审核中',
    });
    expect(countLiveOpenActions([activeA, activeB, notStarted, finished, archivedActive])).toBe(0);
  });
});
