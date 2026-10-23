/**
 * Read-only source schedule window extracted from commercial_project_sources.payload
 * (WP-R2-22A). Dates only — never chat text or other payload fields.
 */

export type CommercialSourceWindow = {
  /** Inclusive window start from the source snapshot. Null when the source gave none. */
  startAt: string | null;
  /** Inclusive window end from the source snapshot. Null when the source gave none. */
  endAt: string | null;
  /** Optional reminder instant from the source snapshot. Null when absent. */
  reminderAt: string | null;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Normalize a payload date field into an ISO instant for API responses.
 * Accepts ISO datetimes or YYYY-MM-DD (Shanghai midnight). Invalid values → null.
 */
export function normalizeSourceWindowInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const trimmed = value.trim();

  const dateOnly = DATE_ONLY_RE.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isRealCalendarDate(year, month, day)) return null;
    // Same convention as wf_nodes.planned_at: Asia/Shanghai calendar midnight.
    const iso = new Date(`${trimmed}T00:00:00+08:00`).toISOString();
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Pure extract from a payload object. Never invents dates. */
export function extractCommercialSourceWindow(
  payload: Record<string, unknown> | null | undefined,
): CommercialSourceWindow {
  if (!payload) {
    return { startAt: null, endAt: null, reminderAt: null };
  }
  return {
    startAt: normalizeSourceWindowInstant(payload.startAt),
    endAt: normalizeSourceWindowInstant(payload.endAt),
    reminderAt: normalizeSourceWindowInstant(payload.reminderAt),
  };
}

/**
 * Bound sources always expose a window object (fields may be null).
 * Unbound projects must not show a source-window row.
 */
export function commercialSourceWindowFromPayload(
  bound: boolean,
  payload: Record<string, unknown> | null | undefined,
): CommercialSourceWindow | null {
  if (!bound) return null;
  return extractCommercialSourceWindow(payload);
}

export function sourceWindowHasDates(window: CommercialSourceWindow | null): boolean {
  if (!window) return false;
  return window.startAt !== null || window.endAt !== null || window.reminderAt !== null;
}
