import { scrubSensitive } from './sensitive';

export type ParsedView = {
  cid: string;
  pubdate: Date;
  title: string;
  ownerMid: string;
  ownerName: string | null;
  coverUrl: string | null;
  viewCount: bigint;
  danmakuCount: bigint;
  commentCount: bigint;
  favoriteCount: bigint;
  coinCount: bigint;
  shareCount: bigint;
  likeCount: bigint;
};

export type ParsedOnline = {
  viewers: bigint;
  raw: string;
};

export type ParsedRelation = {
  followerCount: bigint;
  followingCount: bigint;
};

export type ParsedNav = {
  isLogin: boolean;
  mid: string;
  uname: string;
  face: string | null;
};

export function readBizCode(payload: unknown): { code: number | null; message: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { code: null, message: '响应不是对象' };
  }
  const record = payload as Record<string, unknown>;
  const code = typeof record.code === 'number' ? record.code : null;
  const message = typeof record.message === 'string' ? scrubSensitive(record.message) : '';
  return { code, message: message.slice(0, 120) };
}

export function envelopeData(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return null;
  return (payload as Record<string, unknown>).data ?? null;
}

function asCount(value: unknown, field: string): bigint {
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`字段 ${field} 不是整数`);
}

function asId(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  throw new Error(`字段 ${field} 不是整数标识`);
}

export function parseView(payload: unknown): ParsedView {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('view 缺少 data');
  const record = data as Record<string, unknown>;
  const stat = record.stat;
  if (typeof stat !== 'object' || stat === null) throw new Error('view 缺少 stat');
  const metrics = stat as Record<string, unknown>;
  const owner = record.owner;
  if (typeof owner !== 'object' || owner === null) throw new Error('view 缺少 owner');
  const ownerRecord = owner as Record<string, unknown>;
  if (typeof record.title !== 'string' || record.title.trim() === '') {
    throw new Error('view 缺少 title');
  }
  const pubdate = record.pubdate;
  if (typeof pubdate !== 'number' || !Number.isFinite(pubdate))
    throw new Error('view 缺少 pubdate');
  const pic = record.pic;
  const ownerName = ownerRecord.name;
  return {
    cid: asId(record.cid, 'cid'),
    pubdate: new Date(Math.trunc(pubdate) * 1000),
    title: record.title.trim(),
    ownerMid: asId(ownerRecord.mid, 'owner.mid'),
    ownerName: typeof ownerName === 'string' && ownerName.trim() ? ownerName.trim() : null,
    coverUrl: typeof pic === 'string' && pic.trim() ? pic.trim() : null,
    viewCount: asCount(metrics.view, 'stat.view'),
    danmakuCount: asCount(metrics.danmaku, 'stat.danmaku'),
    commentCount: asCount(metrics.reply, 'stat.reply'),
    favoriteCount: asCount(metrics.favorite, 'stat.favorite'),
    coinCount: asCount(metrics.coin, 'stat.coin'),
    shareCount: asCount(metrics.share, 'stat.share'),
    likeCount: asCount(metrics.like, 'stat.like'),
  };
}

export function onlineRawFromPayload(payload: unknown): string | null {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) return null;
  const total = (data as Record<string, unknown>).total;
  if (typeof total === 'number' && Number.isFinite(total)) return String(Math.trunc(total));
  if (typeof total === 'string' && total.trim()) return total.trim();
  return null;
}

export function parseOnlineTotal(payload: unknown): ParsedOnline {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('online 缺少 data');
  const total = (data as Record<string, unknown>).total;
  if (typeof total === 'number' && Number.isFinite(total)) {
    const viewers = BigInt(Math.trunc(total));
    return { viewers, raw: String(Math.trunc(total)) };
  }
  if (typeof total === 'string') {
    const trimmed = total.trim();
    const numeric = trimmed.endsWith('+') ? trimmed.slice(0, -1) : trimmed;
    if (!/^\d+$/.test(numeric)) throw new Error('在线观看人数无法解析');
    return { viewers: BigInt(numeric), raw: trimmed };
  }
  throw new Error('在线观看人数无法解析');
}

export function parseRelation(payload: unknown): ParsedRelation {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('relation/stat 缺少 data');
  const record = data as Record<string, unknown>;
  return {
    followerCount: asCount(record.follower, 'follower'),
    followingCount: asCount(record.following, 'following'),
  };
}

export function parseNav(payload: unknown): ParsedNav {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('nav 缺少 data');
  const record = data as Record<string, unknown>;
  const face = record.face;
  return {
    isLogin: record.isLogin === true,
    mid: asId(record.mid, 'mid'),
    uname: typeof record.uname === 'string' ? record.uname : '',
    face: typeof face === 'string' && face.trim() ? face.trim() : null,
  };
}

export type QrGenerate = { url: string; qrcodeKey: string };

export function parseQrGenerate(payload: unknown): QrGenerate {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('二维码响应缺少 data');
  const record = data as Record<string, unknown>;
  if (typeof record.url !== 'string' || typeof record.qrcode_key !== 'string') {
    throw new Error('二维码响应缺少 url 或 qrcode_key');
  }
  return { url: record.url, qrcodeKey: record.qrcode_key };
}

export type QrPoll =
  { state: 'waiting' | 'scanned' } | { state: 'expired' } | { state: 'confirmed' };

export function parseQrPoll(payload: unknown): QrPoll {
  const data = envelopeData(payload);
  if (typeof data !== 'object' || data === null) throw new Error('扫码状态缺少 data');
  const code = (data as Record<string, unknown>).code;
  if (code === 86101) return { state: 'waiting' };
  if (code === 86090) return { state: 'scanned' };
  if (code === 86038) return { state: 'expired' };
  if (code === 0) return { state: 'confirmed' };
  throw new Error('无法识别的扫码状态');
}
