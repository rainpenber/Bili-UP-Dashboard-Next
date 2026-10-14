/** Stable JSON for idempotency hashing (sorted object keys, no whitespace). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined) out[k] = sortValue(v);
  }
  return out;
}

export function hermesPayloadHash(
  operation: string,
  projectId: string | null,
  payload: unknown,
): string {
  return canonicalJson({ operation, projectId, payload });
}
