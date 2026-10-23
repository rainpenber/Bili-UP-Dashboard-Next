import type { CommercialOpenItemRead, CommercialProjectDetail } from '@studio/contracts';

/** Test-only filler for read fields the parser now requires. Production parses must not invent these. */
const LIVE_READ_DEFAULTS = {
  createdAt: '2026-05-01T00:00:00.000000Z',
  updatedAt: '2026-05-01T00:00:00.000000Z',
  userDeadlineAt: null,
  blockedSinceAt: null,
  archivedAt: null,
  stageEnteredAt: '2026-05-01T00:00:00.000000Z',
  businessClosedAt: null,
  originKind: 'fixture' as const,
  source: null,
  businessState: null,
  originStatusLabel: null,
  blockedNodeNames: [] as string[],
  openItems: [] as CommercialOpenItemRead[],
};

export function asLiveDetail<T extends Record<string, unknown>>(
  detail: T,
): CommercialProjectDetail & T {
  return { ...LIVE_READ_DEFAULTS, ...detail } as CommercialProjectDetail & T;
}
