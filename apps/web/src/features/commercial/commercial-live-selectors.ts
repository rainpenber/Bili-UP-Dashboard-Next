import type { CommercialOpenItemRead, CommercialProjectListItem } from '@studio/contracts';
import { calendarDayKey, formatScheduleLabel } from './node-schedule';

export type LiveListBucket =
  'blocked_with_reason' | 'blocked_without_reason' | 'active' | 'closed' | 'archived';

const BUCKET_ORDER: Record<LiveListBucket, number> = {
  blocked_with_reason: 0,
  blocked_without_reason: 1,
  active: 2,
  closed: 3,
  archived: 4,
};

export function isArchivedLiveProject(project: CommercialProjectListItem): boolean {
  return project.overallStage === 'archived' || project.archivedAt !== null;
}

/** Soft-delete flag (WP-R2-19E): archived_at set. Dashboard must exclude these entirely. */
export function isSoftArchivedLiveProject(project: CommercialProjectListItem): boolean {
  return project.archivedAt !== null;
}

export function excludeSoftArchivedProjects(
  projects: CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return projects.filter((project) => !isSoftArchivedLiveProject(project));
}

export function onlySoftArchivedProjects(
  projects: CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return projects.filter((project) => isSoftArchivedLiveProject(project));
}

const OVERALL_STAGE_LABEL: Record<string, string> = {
  pre_publish: '发布前',
  published_winding_down: '已上线，收尾中',
  closed: '已结案',
  archived: '已归档',
};

export function liveStageLabel(project: CommercialProjectListItem): string {
  if (project.currentStageNames.length === 0) return '无活动节点';
  return project.currentStageNames.join('、');
}

/** Prefer in-progress / blocked node names; otherwise a friendly overall-stage label. */
export function liveProgressLabel(project: CommercialProjectListItem): string {
  if (project.currentStageNames.length > 0) return project.currentStageNames.join('、');
  return OVERALL_STAGE_LABEL[project.overallStage] ?? project.overallStage;
}

export function liveOriginStatusLabel(project: CommercialProjectListItem): string {
  if (project.originStatusLabel && project.originStatusLabel.trim().length > 0) {
    return project.originStatusLabel;
  }
  return '未记录来源状态';
}

export function liveListBucket(project: CommercialProjectListItem): LiveListBucket {
  if (isArchivedLiveProject(project)) return 'archived';
  if (project.overallStage === 'closed') return 'closed';
  if (project.anyNodeBlocked && project.blockingReason) return 'blocked_with_reason';
  if (project.anyNodeBlocked || project.blockedNodeNames.length > 0) {
    return 'blocked_without_reason';
  }
  return 'active';
}

export function liveInstantLabel(iso: string | null, emptyLabel: string): string {
  if (!iso) return emptyLabel;
  return formatScheduleLabel(iso);
}

export interface LiveProjectListFilters {
  keyword: string;
  /** Keep projects whose created_at Shanghai calendar day is on or after this YYYY-MM-DD. */
  fromDate: string;
}

export function filterLiveProjects(
  projects: CommercialProjectListItem[],
  filters: LiveProjectListFilters,
): CommercialProjectListItem[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return projects.filter((project) => {
    if (filters.fromDate) {
      const createdDay = calendarDayKey(project.createdAt);
      if (!createdDay || createdDay < filters.fromDate) return false;
    }
    if (!keyword) return true;
    const haystack = [
      project.name,
      ...project.currentStageNames,
      ...project.blockedNodeNames,
      project.blockingReason ?? '',
      ...project.openItems.flatMap((item) => [item.title, item.nextAction ?? '']),
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

export function sortLiveProjects(
  projects: CommercialProjectListItem[],
): CommercialProjectListItem[] {
  return [...projects].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[liveListBucket(a)] - BUCKET_ORDER[liveListBucket(b)];
    if (bucketDiff !== 0) return bucketDiff;
    const createdDiff = b.createdAt.localeCompare(a.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });
}

export type LiveActionItem = CommercialOpenItemRead & { projectId: string };

function liveOpenActions(
  projects: CommercialProjectListItem[],
  actor: CommercialOpenItemRead['nextActor'],
): LiveActionItem[] {
  const rows: LiveActionItem[] = [];
  for (const project of projects) {
    if (isSoftArchivedLiveProject(project)) continue;
    for (const item of project.openItems) {
      if (item.lifecycle !== 'open' || item.nextActor !== actor) continue;
      rows.push({ ...item, projectId: project.id });
    }
  }
  return rows;
}

export function getLiveOurActionItems(projects: CommercialProjectListItem[]): LiveActionItem[] {
  return liveOpenActions(projects, 'us');
}

export function getLiveClientActionItems(projects: CommercialProjectListItem[]): LiveActionItem[] {
  return liveOpenActions(projects, 'client');
}

export interface LiveBlockedSummary {
  projectId: string;
  projectName: string;
  archived: boolean;
  blockedNodeNames: string[];
  blockingReason: string | null;
  userDeadlineAt: string | null;
  blockedSinceAt: string | null;
  closedItemCount: number;
}

export function getLiveBlockedSummaries(
  projects: CommercialProjectListItem[],
): LiveBlockedSummary[] {
  return projects
    .filter((project) => !isSoftArchivedLiveProject(project))
    .filter((project) => project.anyNodeBlocked || project.blockedNodeNames.length > 0)
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      archived: false,
      blockedNodeNames: project.blockedNodeNames,
      blockingReason: project.blockingReason,
      userDeadlineAt: project.userDeadlineAt,
      blockedSinceAt: project.blockedSinceAt,
      closedItemCount: project.openItems.filter((item) => item.lifecycle === 'closed').length,
    }));
}

export interface LiveActiveProjectSummary {
  projectId: string;
  projectName: string;
  progressLabel: string;
  originStatusLabel: string;
  businessState: 'active';
}

/**
 * Active business-state projects for the home board.
 * Independent of openItems / blocked nodes; soft-archived rows stay out.
 */
export function getLiveActiveProjects(
  projects: CommercialProjectListItem[],
): LiveActiveProjectSummary[] {
  return sortLiveProjects(projects)
    .filter((project) => !isSoftArchivedLiveProject(project))
    .filter((project) => project.businessState === 'active')
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      progressLabel: liveProgressLabel(project),
      originStatusLabel: liveOriginStatusLabel(project),
      businessState: 'active' as const,
    }));
}

export function countLiveOpenActions(projects: CommercialProjectListItem[]): number {
  return getLiveOurActionItems(projects).length + getLiveClientActionItems(projects).length;
}
