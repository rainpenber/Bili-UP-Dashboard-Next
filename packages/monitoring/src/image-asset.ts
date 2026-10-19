import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Sql } from '@studio/db';
import { assetIdFromContentSha256 } from './asset-id';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageRejectReason = 'scheme' | 'host' | 'size' | 'type' | 'status' | 'timeout';

export class ImageReject extends Error {
  readonly reason: ImageRejectReason;

  constructor(reason: ImageRejectReason, message: string) {
    super(message);
    this.name = 'ImageReject';
    this.reason = reason;
  }
}

export type SniffedImage = {
  mime: ImageMime;
  width: number | null;
  height: number | null;
};

export type BinaryResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  finalUrl: string;
};

export type BinaryTransport = (request: {
  url: string;
  headers: Record<string, string>;
}) => Promise<BinaryResponse>;

export function assertHdslbUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageReject('scheme', '图片地址不合法');
  }
  if (url.protocol !== 'https:') {
    throw new ImageReject('scheme', '图片只允许 HTTPS');
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'hdslb.com' && !host.endsWith('.hdslb.com')) {
    throw new ImageReject('host', '图片只允许 hdslb.com');
  }
  return url;
}

export function httpsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  return trimmed;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readU16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  return riff === 'RIFF' && webp === 'WEBP';
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !isPng(bytes)) return null;
  return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpeg(bytes)) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = readU16(bytes, offset + 2);
    if (length < 2) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 9 < bytes.length) {
      return { height: readU16(bytes, offset + 5), width: readU16(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isWebp(bytes) || bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (chunk !== 'VP8X') return null;
  const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
  const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
  return { width, height };
}

export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (isGif(bytes)) throw new ImageReject('type', '拒绝 GIF');
  if (isPng(bytes)) {
    const size = pngSize(bytes);
    return { mime: 'image/png', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (isJpeg(bytes)) {
    const size = jpegSize(bytes);
    return { mime: 'image/jpeg', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (isWebp(bytes)) {
    const size = webpSize(bytes);
    return { mime: 'image/webp', width: size?.width ?? null, height: size?.height ?? null };
  }
  throw new ImageReject('type', '图片魔数无法识别');
}

function header(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

export function extensionForMime(mime: ImageMime): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function contentAddressedRelativePath(
  kind: 'cover' | 'face',
  sha256: string,
  ext: string,
): string {
  return `bili/${kind}/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

export async function downloadHdslbImage(
  rawUrl: string,
  transport: BinaryTransport,
): Promise<{
  bytes: Uint8Array;
  mime: ImageMime;
  width: number | null;
  height: number | null;
  finalUrl: string;
}> {
  const requested = assertHdslbUrl(rawUrl);
  const response = await transport({
    url: requested.toString(),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
      Accept: 'image/avif,image/webp,image/png,image/jpeg',
    },
  });
  assertHdslbUrl(response.finalUrl);
  if (response.status !== 200) {
    throw new ImageReject('status', `图片响应状态 ${response.status}`);
  }
  const contentType =
    header(response.headers, 'content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType === 'image/gif') throw new ImageReject('type', '拒绝 image/gif');
  const declared = header(response.headers, 'content-length');
  if (declared && Number(declared) > MAX_IMAGE_BYTES) {
    throw new ImageReject('size', '图片超过 8 MiB');
  }
  if (response.body.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageReject('size', '图片超过 8 MiB');
  }
  const sniffed = sniffImage(response.body);
  return {
    bytes: response.body,
    mime: sniffed.mime,
    width: sniffed.width,
    height: sniffed.height,
    finalUrl: response.finalUrl,
  };
}

async function writeAtomic(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);
}

export async function storeImageBytes(
  sql: Sql,
  input: {
    assetsRoot: string;
    bytes: Uint8Array;
    mime: ImageMime;
    width: number | null;
    height: number | null;
    kind: 'cover' | 'face';
    origin: 'webui' | 'bilibili';
    sourceUrl: string | null;
    importBatchId: string | null;
    fetchedAt: Date | null;
  },
): Promise<{ assetId: string; sha256: string; relativePath: string }> {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const assetId = assetIdFromContentSha256(sha256);
  const relativePath = contentAddressedRelativePath(
    input.kind,
    sha256,
    extensionForMime(input.mime),
  );
  await writeAtomic(input.assetsRoot, relativePath, input.bytes);
  await sql`
    INSERT INTO static_assets (
      asset_id, content_sha256, mime_type, relative_path, import_batch_id,
      kind, source_url, byte_size, width, height, fetched_at, origin
    ) VALUES (
      ${assetId},
      ${sha256},
      ${input.mime},
      ${relativePath},
      ${input.importBatchId}::uuid,
      ${input.kind},
      ${input.sourceUrl},
      ${input.bytes.byteLength},
      ${input.width},
      ${input.height},
      ${input.fetchedAt},
      ${input.origin}
    )
    ON CONFLICT (asset_id) DO UPDATE SET
      width = COALESCE(static_assets.width, EXCLUDED.width),
      height = COALESCE(static_assets.height, EXCLUDED.height),
      byte_size = COALESCE(static_assets.byte_size, EXCLUDED.byte_size),
      mime_type = COALESCE(static_assets.mime_type, EXCLUDED.mime_type)
  `;
  return { assetId, sha256, relativePath };
}

const IMAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Accept: 'image/avif,image/webp,image/png,image/jpeg',
};

/** Live hdslb download. No Cookie. Redirects are checked hop by hop. Tests must not call this. */
export function createLiveImageTransport(timeoutMs = 10_000): BinaryTransport {
  return async (request) => {
    let current = assertHdslbUrl(request.url).toString();
    for (let hop = 0; hop < 4; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { ...IMAGE_HEADERS, ...request.headers };
        delete headers.Cookie;
        delete headers.cookie;
        const response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers,
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new ImageReject('status', '图片重定向缺少 Location');
          current = assertHdslbUrl(new URL(location, current).toString()).toString();
          continue;
        }
        const declared = response.headers.get('content-length');
        if (declared && Number(declared) > MAX_IMAGE_BYTES) {
          throw new ImageReject('size', '图片超过 8 MiB');
        }
        const body = new Uint8Array(await response.arrayBuffer());
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        return { status: response.status, headers: responseHeaders, body, finalUrl: current };
      } catch (error) {
        if (error instanceof ImageReject) throw error;
        const timedOut = error instanceof Error && error.name === 'AbortError';
        if (timedOut) throw new ImageReject('timeout', '图片下载超时');
        throw new ImageReject('status', '图片下载失败');
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ImageReject('status', '图片重定向次数过多');
  };
}
