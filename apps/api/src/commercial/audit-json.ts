/** Write JSON/JSONB without double-encoding (postgres.js serializes plain objects). */
export function auditJson(value: unknown) {
  if (value === undefined || value === null) return null;
  return value as never;
}

export function normalizeAuditDetail(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (typeof parsed === 'string') {
        try {
          const twice = JSON.parse(parsed) as unknown;
          if (twice && typeof twice === 'object' && !Array.isArray(twice)) {
            return twice as Record<string, unknown>;
          }
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}
