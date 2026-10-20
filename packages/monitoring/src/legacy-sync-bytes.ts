import { createHash, type Hash } from 'node:crypto';

const BOUNDARY_BYTES = 256;

export type PrefixFingerprint = {
  prefixSha256: string;
  boundarySha256: string;
  boundaryLength: number;
};

type CopyableHash = Hash & { copy(): Hash };

/** Incremental SHA-256 of a consumed prefix, plus a hash of its trailing boundary. */
export class PrefixHasher {
  private readonly hash: Hash = createHash('sha256');
  private tail: Buffer = Buffer.alloc(0);

  update(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.hash.update(chunk);
    if (chunk.length >= BOUNDARY_BYTES) {
      this.tail = Buffer.from(chunk.subarray(chunk.length - BOUNDARY_BYTES));
      return;
    }
    const merged = Buffer.concat([this.tail, chunk]);
    this.tail =
      merged.length <= BOUNDARY_BYTES
        ? merged
        : Buffer.from(merged.subarray(merged.length - BOUNDARY_BYTES));
  }

  snapshot(): PrefixFingerprint {
    const copy = (this.hash as CopyableHash).copy;
    if (typeof copy !== 'function') throw new Error('运行时不支持增量哈希复制');
    return {
      prefixSha256: copy.call(this.hash).digest('hex'),
      boundarySha256: createHash('sha256').update(this.tail).digest('hex'),
      boundaryLength: this.tail.length,
    };
  }
}

export function takeCompleteLines(
  buf: Buffer,
  maxLines: number,
): { done: Buffer; rest: Buffer; lines: number } {
  if (maxLines < 1) throw new Error('maxLines 至少为 1');
  let lines = 0;
  let end = 0;
  for (let index = 0; index < buf.length && lines < maxLines; index += 1) {
    if (buf[index] === 0x0a) {
      lines += 1;
      end = index + 1;
    }
  }
  return { done: buf.subarray(0, end), rest: buf.subarray(end), lines };
}

export function decodeLegacyHeader(lineBytes: Buffer): string {
  let text = lineBytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r?\n$/, '').trim();
}
