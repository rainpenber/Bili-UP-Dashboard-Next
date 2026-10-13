export type DashboardItemKind = 'node_due' | 'open_item' | 'blocked_project';

export type DashboardPriorityInput = {
  id: string;
  kind: DashboardItemKind;
  projectId: string;
  dueAt: string | null;
  isOverdue: boolean;
  isBlocked: boolean;
  blockedDownstreamCount: number;
  waitingParty: 'us' | 'client' | 'confirmation' | null;
  waitingExternalHours: number;
  publishWithinDays: number | null;
};

export type RankedDashboardItem = DashboardPriorityInput & {
  rank: number;
  sortReasons: string[];
  explanation: string;
};

function scoreItem(item: DashboardPriorityInput): { rank: number; reasons: string[] } {
  const reasons: string[] = [];
  let rank = 1000;
  if (item.isOverdue) {
    rank = 10;
    reasons.push('已逾期');
  } else if (item.publishWithinDays != null && item.publishWithinDays < 7 && item.isBlocked) {
    rank = 20;
    reasons.push('距计划发布不足 7 天且存在阻塞');
  } else if (item.blockedDownstreamCount >= 2) {
    rank = 30;
    reasons.push(`阻塞 ${item.blockedDownstreamCount} 个下游节点`);
  } else if (item.waitingParty === 'us') {
    rank = 40;
    reasons.push('等待我方动作');
  } else if (item.waitingParty === 'client' && item.waitingExternalHours >= 48) {
    rank = 50;
    reasons.push('等待外部超过 48 小时');
  } else if (item.dueAt) {
    rank = 60;
    reasons.push('临期事项');
  } else {
    rank = 70;
    reasons.push('常规跟进');
  }
  return { rank, reasons };
}

export function rankDashboardItems(items: DashboardPriorityInput[]): RankedDashboardItem[] {
  return items
    .map((item) => {
      const { rank, reasons } = scoreItem(item);
      return {
        ...item,
        rank,
        sortReasons: reasons,
        explanation: reasons.join('；'),
      };
    })
    .sort((a, b) => a.rank - b.rank || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
}
