/** Pino redact paths. String scrub below still runs on the serialized line. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  '*.SESSDATA',
  '*.bili_jct',
  '*.password',
  '*.secret',
  '*.ciphertext',
] as const;

const SENSITIVE_KEYS = new Set([
  'cookie',
  'cookies',
  'authorization',
  'password',
  'secret',
  'ciphertext',
  'sessdata',
  'bili_jct',
  'set-cookie',
  'auth_tag',
  'authtag',
]);

/**
 * Assignment patterns from the logging spec, then the bare secret words so a
 * stored row cannot round-trip those tokens into an ops response.
 */
export function scrubString(value: string): string {
  return value
    .replace(/SESSDATA=[^;]+/gi, '[redacted]')
    .replace(/bili_jct=[^;]+/gi, '[redacted]')
    .replace(/Bearer [A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/SESSDATA/gi, '[redacted]')
    .replace(/bili_jct/gi, '[redacted]')
    .replace(/password/gi, '[redacted]')
    .replace(/ciphertext/gi, '[redacted]');
}

export function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (typeof value === 'object' && value) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      out[key] = scrubValue(child);
    }
    return out;
  }
  return null;
}

export function scrubUnknown(value: unknown): unknown {
  try {
    return JSON.parse(scrubString(JSON.stringify(scrubValue(value)))) as unknown;
  } catch {
    return scrubValue(value);
  }
}
