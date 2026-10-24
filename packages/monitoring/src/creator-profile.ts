/**
 * UP profile (face / uname) parsers for card + space acc/info.
 */

import { httpsUrl } from './image-asset';

export type CreatorProfile = {
  mid: string;
  faceUrl: string | null;
  uname: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function midString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** Parse x/web-interface/card payload. */
export function parseCreatorCard(payload: unknown, expectedMid: string): CreatorProfile {
  const root = asRecord(payload);
  const data = root ? asRecord(root.data) : null;
  const card = data ? asRecord(data.card) : null;
  if (!card) throw new Error('名片接口缺少 card');
  const mid = midString(card.mid);
  if (mid && mid !== expectedMid) throw new Error('名片 mid 与请求不一致');
  const face = optionalText(card.face);
  const uname = optionalText(card.name) ?? optionalText(card.uname);
  return {
    mid: expectedMid,
    faceUrl: face ? httpsUrl(face) : null,
    uname,
  };
}

/** Parse x/space/acc/info (or wbi acc/info) payload. */
export function parseCreatorSpaceAccInfo(payload: unknown, expectedMid: string): CreatorProfile {
  const root = asRecord(payload);
  const data = root ? asRecord(root.data) : null;
  if (!data) throw new Error('空间信息缺少 data');
  const mid = midString(data.mid);
  if (mid && mid !== expectedMid) throw new Error('空间信息 mid 与请求不一致');
  const face = optionalText(data.face);
  const uname = optionalText(data.name) ?? optionalText(data.uname);
  return {
    mid: expectedMid,
    faceUrl: face ? httpsUrl(face) : null,
    uname,
  };
}
