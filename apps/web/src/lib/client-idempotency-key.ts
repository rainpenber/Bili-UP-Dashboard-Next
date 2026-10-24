/**
 * Client-side idempotency / correlation id for write requests.
 * Prefer crypto.randomUUID when available (secure contexts); otherwise build a
 * UUID v4 from getRandomValues; last resort is a unique non-crypto fallback for
 * non-secure HTTP / stripped test environments — still only a client key.
 */

function bytesToUuidV4(bytes: Uint8Array): string {
  // RFC 4122 variant + version bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let fallbackSeq = 0;

function fallbackClientKey(): string {
  fallbackSeq += 1;
  const stamp = Date.now().toString(16).padStart(11, '0');
  const seq = fallbackSeq.toString(16).padStart(5, '0');
  const rand = Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16);
  const raw = `${stamp}${seq}${rand}`.slice(0, 32).padEnd(32, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  }
  return bytesToUuidV4(bytes);
}

export type ClientIdempotencyCrypto = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

/** Generate a UUID-shaped client idempotency key without requiring a secure context. */
export function createClientIdempotencyKey(
  cryptoImpl: ClientIdempotencyCrypto | undefined = globalThis.crypto,
): string {
  if (typeof cryptoImpl?.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  if (typeof cryptoImpl?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    return bytesToUuidV4(bytes);
  }
  return fallbackClientKey();
}
