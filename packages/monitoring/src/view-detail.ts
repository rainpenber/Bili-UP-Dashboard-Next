export type ParsedCard = {
  name: string | null;
  face: string | null;
  sign: string | null;
  follower: bigint | null;
  archiveCount: number | null;
};

export type ParsedViewDetail = {
  bvid: string | null;
  aid: string | null;
  cid: string | null;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  pubdate: Date | null;
  tid: number | null;
  tidV2: number | null;
  /** Raw label. Empty string stays empty; callers must not invent a partition name. */
  tname: string;
  tnameV2: string;
  pic: string | null;
  ownerMid: string | null;
  ownerName: string | null;
  ownerFace: string | null;
  /** Null when the response omitted Tags, so existing rows are left alone. */
  tags: string[] | null;
  card: ParsedCard | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function optionalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rawLabel(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalBigint(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function readTags(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const name = typeof item === 'string' ? item : record ? optionalText(record.tag_name) : null;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tags.push(name);
  }
  return tags;
}

function readCard(value: unknown): ParsedCard | null {
  const card = asRecord(value);
  if (!card) return null;
  let inner = asRecord(card.card);
  if (!inner && typeof card.card === 'string') {
    try {
      inner = asRecord(JSON.parse(card.card) as unknown);
    } catch {
      inner = null;
    }
  }
  return {
    name: inner ? optionalText(inner.name) : null,
    face: inner ? optionalText(inner.face) : null,
    sign: inner ? (typeof inner.sign === 'string' ? inner.sign : null) : null,
    follower: optionalBigint(card.follower),
    archiveCount: optionalInt(card.archive_count),
  };
}

export function parseViewDetail(payload: unknown): ParsedViewDetail {
  const root = asRecord(payload);
  const data = root ? asRecord(root.data) : null;
  const view = data ? asRecord(data.View) : null;
  if (!view) throw new Error('view/detail 缺少 View');
  const owner = asRecord(view.owner);
  const pubdate = view.pubdate;
  const duration = view.duration;
  return {
    bvid: optionalText(view.bvid),
    aid: optionalId(view.aid),
    cid: optionalId(view.cid),
    title: optionalText(view.title),
    description: typeof view.desc === 'string' ? view.desc : null,
    durationSeconds:
      typeof duration === 'number' && Number.isFinite(duration) ? Math.trunc(duration) : null,
    pubdate:
      typeof pubdate === 'number' && Number.isFinite(pubdate)
        ? new Date(Math.trunc(pubdate) * 1000)
        : null,
    tid: optionalInt(view.tid),
    tidV2: optionalInt(view.tid_v2),
    tname: rawLabel(view.tname),
    tnameV2: rawLabel(view.tname_v2),
    pic: optionalText(view.pic),
    ownerMid: owner ? optionalId(owner.mid) : null,
    ownerName: owner ? optionalText(owner.name) : null,
    ownerFace: owner ? optionalText(owner.face) : null,
    tags: data ? readTags(data.Tags) : null,
    card: data ? readCard(data.Card) : null,
  };
}
