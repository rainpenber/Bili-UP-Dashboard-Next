/**
 * Display-only business state derived from a commercial source snapshot (WP-R2-19C).
 * Does not drive workflow nodes, amounts, or completion timestamps.
 */

export const COMMERCIAL_BUSINESS_STATES = ['not_started', 'active', 'finished'] as const;
export type CommercialBusinessState = (typeof COMMERCIAL_BUSINESS_STATES)[number];

export function isCommercialBusinessState(value: unknown): value is CommercialBusinessState {
  return (
    typeof value === 'string' &&
    (COMMERCIAL_BUSINESS_STATES as readonly string[]).includes(value)
  );
}

/**
 * Frozen source `detail_status` / `sourceStatus` vocabulary (13 labels).
 * Mapping is exact-string only; unknown labels fall back to `active`.
 */
export const KNOWN_SOURCE_DETAIL_STATUSES = [
  '0.未确定',
  '1.未开始',
  '1.放弃-主动拒绝',
  '1.放弃-未过提报',
  '1.意外终止',
  '2.进行中',
  '2.进行中-脚本',
  '2.进行中-拍摄',
  '2.进行中-后期',
  '3.收尾-审核中',
  '3.收尾-上线待结算',
  '3.收尾-已提现',
  '母任务',
] as const;

export type KnownSourceDetailStatus = (typeof KNOWN_SOURCE_DETAIL_STATUSES)[number];

const NOT_STARTED_STATUSES = new Set<string>([
  '1.放弃-主动拒绝',
  '1.放弃-未过提报',
  '1.意外终止',
  '1.未开始',
  '0.未确定',
]);

const FINISHED_STATUSES = new Set<string>(['3.收尾-已提现']);

const ACTIVE_STATUSES = new Set<string>([
  '2.进行中',
  '2.进行中-脚本',
  '2.进行中-拍摄',
  '2.进行中-后期',
  '3.收尾-审核中',
  '3.收尾-上线待结算',
  '母任务',
]);

/** Exhaustive known map used by table-driven tests. */
export const SOURCE_DETAIL_STATUS_BUSINESS_STATE: Readonly<
  Record<KnownSourceDetailStatus, CommercialBusinessState>
> = {
  '0.未确定': 'not_started',
  '1.未开始': 'not_started',
  '1.放弃-主动拒绝': 'not_started',
  '1.放弃-未过提报': 'not_started',
  '1.意外终止': 'not_started',
  '2.进行中': 'active',
  '2.进行中-脚本': 'active',
  '2.进行中-拍摄': 'active',
  '2.进行中-后期': 'active',
  '3.收尾-审核中': 'active',
  '3.收尾-上线待结算': 'active',
  '3.收尾-已提现': 'finished',
  母任务: 'active',
};

export type CommercialBusinessStateDerivation = {
  businessState: CommercialBusinessState;
  /** Raw source status label, unchanged. Null when the snapshot has no status text. */
  originStatusLabel: string | null;
};

/**
 * Pure display mapping from a source status snapshot.
 * - Known not-started / finished labels map exactly.
 * - Known in-progress / wrap-up / parent-task labels map to `active`.
 * - Unknown labels must not be guessed: return `active` and keep the raw label.
 */
export function deriveCommercialBusinessState(
  sourceStatus: string | null | undefined,
): CommercialBusinessStateDerivation {
  const originStatusLabel =
    typeof sourceStatus === 'string' && sourceStatus.length > 0 ? sourceStatus : null;
  if (originStatusLabel === null) {
    return { businessState: 'active', originStatusLabel: null };
  }
  if (NOT_STARTED_STATUSES.has(originStatusLabel)) {
    return { businessState: 'not_started', originStatusLabel };
  }
  if (FINISHED_STATUSES.has(originStatusLabel)) {
    return { businessState: 'finished', originStatusLabel };
  }
  if (ACTIVE_STATUSES.has(originStatusLabel)) {
    return { businessState: 'active', originStatusLabel };
  }
  return { businessState: 'active', originStatusLabel };
}

/** Projects without a source binding must not show a display-state badge. */
export function commercialDisplayStateFromSource(source: {
  sourceStatus: string | null;
} | null): {
  businessState: CommercialBusinessState | null;
  originStatusLabel: string | null;
} {
  if (source === null) {
    return { businessState: null, originStatusLabel: null };
  }
  return deriveCommercialBusinessState(source.sourceStatus);
}
