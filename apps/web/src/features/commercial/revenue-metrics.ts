import type { CommercialProjectDetail, CommercialRebate } from '@studio/contracts';

const SHANGHAI = 'Asia/Shanghai';
const MONTH_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: '2-digit',
});

export type RevenueMonthMetrics = {
  count: number;
  platformTotal: string;
  rebateTotal: string;
  netTotal: string;
};

function monthKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = MONTH_PARTS.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : null;
}

function cents(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function money(value: number): string {
  return (value / 100).toFixed(2);
}

/**
 * Groups projects by publish month (Asia/Shanghai). Projects without a publish
 * time fall back to createdAt, per WP-OC-015.
 */
export function revenueMonthMetrics(
  projects: CommercialProjectDetail[],
  now: Date,
): RevenueMonthMetrics {
  const target = monthKey(now.toISOString());
  let count = 0;
  let platform = 0;
  let rebate = 0;
  let net = 0;
  for (const project of projects) {
    const stamp = project.publish.publishedAt ?? project.createdAt;
    if (monthKey(stamp) !== target) continue;
    count += 1;
    platform += cents(project.platformAmount);
    rebate += cents(project.rebateAmount);
    net += cents(project.netAmount);
  }
  return {
    count,
    platformTotal: money(platform),
    rebateTotal: money(rebate),
    netTotal: money(net),
  };
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * Finds the ledger row for a project detail page. Linked rows win. Historical
 * rows have no project_id, so exact normalized name wins, then the closest
 * prefix (e.g. seed「大疆 Pocket4」for project「大疆 Pocket4 寄拍」).
 */
export function matchRebateForProject(
  items: CommercialRebate[],
  projectId: string,
  projectName: string | null | undefined,
): CommercialRebate | null {
  const linked = items.find((item) => item.projectId === projectId);
  if (linked) return linked;
  if (!projectName) return null;
  const target = normalizedName(projectName);
  const historical = items.filter((item) => item.projectId === null);
  const exact = historical.find((item) => normalizedName(item.projectName) === target);
  if (exact) return exact;
  let best: { item: (typeof historical)[number]; distance: number } | null = null;
  for (const item of historical) {
    const name = normalizedName(item.projectName);
    if (!target.startsWith(name) && !name.startsWith(target)) continue;
    const distance = Math.abs(name.length - target.length);
    if (!best || distance < best.distance) best = { item, distance };
  }
  return best?.item ?? null;
}
