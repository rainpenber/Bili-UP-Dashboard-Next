import { rankDashboardItems } from './dashboard-priority';
import { shanghaiDayBounds } from './shanghai-day';

export type DashboardEntryDraft = {
  id: string;
  kind: 'node' | 'open_item' | 'project';
  projectId: string;
  projectName: string;
  title: string;
  issue: string;
  responsibleParty: string;
  dueAt: string | null;
  suggestedNextStep: string;
  focusNodeId: string | null;
  focusOpenItemId: string | null;
  nodeStatus?: string;
  itemType?: string;
  openItemStatus?: string;
  humanConfirmed?: boolean;
  blockedDownstreamCount?: number;
  publishWithinDays?: number | null;
  isBlocked?: boolean;
};

export type EnrichedDashboardEntry = DashboardEntryDraft & {
  rank: number;
  sortReasons: string[];
  explanation: string;
};

export type DashboardBuckets = {
  overdue: EnrichedDashboardEntry[];
  dueToday: EnrichedDashboardEntry[];
  dueNext7Days: EnrichedDashboardEntry[];
  blockedProjects: EnrichedDashboardEntry[];
  waitingClient: EnrichedDashboardEntry[];
  waitingUs: EnrichedDashboardEntry[];
  pendingConfirmation: EnrichedDashboardEntry[];
};

function sortGroup(items: EnrichedDashboardEntry[]): EnrichedDashboardEntry[] {
  return [...items].sort((a, b) => a.rank - b.rank || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
}

function toRankInput(e: DashboardEntryDraft, now: Date) {
  const waitingParty =
    e.responsibleParty === 'us'
      ? ('us' as const)
      : e.responsibleParty === 'client'
        ? ('client' as const)
        : e.itemType === 'confirmation' || e.issue === 'confirmation'
          ? ('confirmation' as const)
          : null;
  return {
    id: e.id,
    kind:
      e.kind === 'node'
        ? ('node_due' as const)
        : e.kind === 'open_item'
          ? ('open_item' as const)
          : ('blocked_project' as const),
    projectId: e.projectId,
    dueAt: e.dueAt,
    isOverdue: e.dueAt ? new Date(e.dueAt) < now : false,
    isBlocked: e.isBlocked ?? e.kind === 'project',
    blockedDownstreamCount: e.blockedDownstreamCount ?? 0,
    waitingParty,
    waitingExternalHours: 0,
    publishWithinDays: e.publishWithinDays ?? null,
  };
}

export function buildDashboardBuckets(
  drafts: DashboardEntryDraft[],
  now: Date,
): { enriched: EnrichedDashboardEntry[] } & DashboardBuckets {
  const ranked = rankDashboardItems(drafts.map((d) => toRankInput(d, now)));
  const byId = new Map(ranked.map((r) => [r.id, r]));
  const enriched: EnrichedDashboardEntry[] = drafts.map((d) => {
    const r = byId.get(d.id)!;
    return {
      ...d,
      rank: r.rank,
      sortReasons: r.sortReasons,
      explanation: r.explanation,
    };
  });

  const { start, end, endPlus7 } = shanghaiDayBounds(now);

  const isDueBucket = (dueAt: string | null) => {
    if (!dueAt) return { overdue: false, today: false, next7: false };
    const due = new Date(dueAt);
    return {
      overdue: due < now,
      today: due >= start && due < end,
      next7: due >= end && due < endPlus7,
    };
  };

  const activeNode = (d: DashboardEntryDraft) =>
    d.kind === 'node' && d.nodeStatus !== 'completed' && d.nodeStatus !== 'skipped';

  const openItem = (d: DashboardEntryDraft) =>
    d.kind === 'open_item' && d.openItemStatus === 'open';

  const dueOpenItem = (e: EnrichedDashboardEntry, bucket: keyof ReturnType<typeof isDueBucket>) =>
    openItem(e) && e.dueAt != null && isDueBucket(e.dueAt)[bucket];

  return {
    enriched,
    overdue: sortGroup(
      enriched.filter(
        (e) =>
          (activeNode(e) && e.dueAt && isDueBucket(e.dueAt).overdue) || dueOpenItem(e, 'overdue'),
      ),
    ),
    dueToday: sortGroup(
      enriched.filter(
        (e) => (activeNode(e) && e.dueAt && isDueBucket(e.dueAt).today) || dueOpenItem(e, 'today'),
      ),
    ),
    dueNext7Days: sortGroup(
      enriched.filter(
        (e) => (activeNode(e) && e.dueAt && isDueBucket(e.dueAt).next7) || dueOpenItem(e, 'next7'),
      ),
    ),
    waitingClient: sortGroup(
      enriched.filter(
        (e) =>
          (e.kind === 'node' && e.nodeStatus === 'waiting_external') ||
          (openItem(e) && (e.itemType === 'client_reply' || e.responsibleParty === 'client')),
      ),
    ),
    waitingUs: sortGroup(
      enriched.filter(
        (e) => openItem(e) && (e.responsibleParty === 'us' || e.itemType === 'our_action'),
      ),
    ),
    pendingConfirmation: sortGroup(
      enriched.filter(
        (e) => openItem(e) && e.itemType === 'confirmation' && e.humanConfirmed === false,
      ),
    ),
    blockedProjects: sortGroup(enriched.filter((e) => e.kind === 'project')),
  };
}
