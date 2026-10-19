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

export function liveStageLabel(project: CommercialProjectListItem): string {
  if (project.currentStageNames.length === 0) return '无活动节点';
  return project.currentStageNames.join('、');
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
    if (isArchivedLiveProject(project)) continue;
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
    .filter((project) => project.anyNodeBlocked || project.blockedNodeNames.length > 0)
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      archived: isArchivedLiveProject(project),
      blockedNodeNames: project.blockedNodeNames,
      blockingReason: project.blockingReason,
      userDeadlineAt: project.userDeadlineAt,
      blockedSinceAt: project.blockedSinceAt,
      closedItemCount: project.openItems.filter((item) => item.lifecycle === 'closed').length,
    }));
}
