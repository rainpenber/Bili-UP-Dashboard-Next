import type {
  BlockedProjectSummary,
  CommercialOpenItem,
  CommercialProject,
  ProjectListBucket,
} from './types';

const BUCKET_ORDER: Record<ProjectListBucket, number> = {
  blocked_with_reason: 0,
  in_progress: 1,
  published_winding_down: 2,
  archived: 3,
};

export function sortProjectsForList(projects: CommercialProject[]): CommercialProject[] {
  return [...projects].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[a.listBucket] - BUCKET_ORDER[b.listBucket];
    if (bucketDiff !== 0) return bucketDiff;
    if (a.hasConcreteBlockReason !== b.hasConcreteBlockReason) {
      return a.hasConcreteBlockReason ? -1 : 1;
    }
    return b.sortDate.localeCompare(a.sortDate);
  });
}

export interface ProjectListFilters {
  keyword: string;
  /** 仅保留 sortDate >= 此 ISO 日期的项目；空字符串表示不限 */
  fromDate: string;
}

export function filterProjects(
  projects: CommercialProject[],
  filters: ProjectListFilters,
): CommercialProject[] {
  const kw = filters.keyword.trim().toLowerCase();
  return projects.filter((p) => {
    if (filters.fromDate && p.sortDate < filters.fromDate) return false;
    if (!kw) return true;
    return p.keywordHaystack.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw);
  });
}

function openItems(projects: CommercialProject[]): CommercialOpenItem[] {
  return projects
    .flatMap((p) => p.openItems)
    .filter((item) => !projects.find((p) => p.id === item.projectId)?.archived);
}

export function getOurActionItems(projects: CommercialProject[]): CommercialOpenItem[] {
  return openItems(projects).filter((i) => i.side === 'ours');
}

export function getClientActionItems(projects: CommercialProject[]): CommercialOpenItem[] {
  return openItems(projects).filter((i) => i.side === 'client');
}

export function getBlockedProjectSummaries(projects: CommercialProject[]): BlockedProjectSummary[] {
  return projects
    .filter(
      (p) =>
        !p.archived &&
        p.blockedNodeName &&
        p.mainBlockingItem &&
        p.userFacingDeadline != null &&
        p.blockedDays != null,
    )
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      blockedNode: p.blockedNodeName!,
      mainBlockingItem: p.mainBlockingItem!,
      userFacingDeadline: p.userFacingDeadline!,
      blockedDays: p.blockedDays!,
    }));
}

export function findProjectById(
  projects: CommercialProject[],
  id: string,
): CommercialProject | undefined {
  return projects.find((p) => p.id === id);
}

export function formatYuan(amount: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);
}
