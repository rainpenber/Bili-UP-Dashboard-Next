/**
 * 投稿列表 / 空间动态列表解析。
 * 端点与字段来自固定 commit 文档：
 * - reference/bilibili-api/space-arc-search.md → GET /x/space/wbi/arc/search
 * - reference/bilibili-api/space-dynamic-feed.md → GET /x/polymer/web-dynamic/v1/feed/space
 *
 * WP-R2-26D: 空间动态逐条解析；单条失败记 skip，不拖垮整页。
 */

const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const BVID_IN_TEXT = /BV[1-9A-HJ-NP-Za-km-z]{10}/;
const MAX_MAJOR_DEPTH = 6;
const DYNAMIC_ID = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;

export type ParsedArchiveVideo = {
  bvid: string;
  title: string;
  created: bigint;
  mid: string | null;
  /** Cover URL from list `pic` (https-normalized by callers). */
  pic: string | null;
};

export type ParsedSpaceDynamic = {
  dynamicId: string;
  publishedAtSec: bigint;
  title: string;
  /** Optional body text from list modules (for title fallback). */
  text?: string;
  /** AV dynamics: bvid from module_dynamic.major.archive. */
  bvid?: string;
};

export type DiscoveryItemSkip = {
  externalId: string;
  reason: string;
};

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 格式不正确`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNonNegative(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`字段 ${field} 不是非负整数`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`字段 ${field} 不是安全非负整数`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && NON_NEGATIVE_INTEGER.test(value)) return BigInt(value);
  throw new Error(`字段 ${field} 不是非负整数`);
}

export function parseSpaceArcSearch(payload: unknown): ParsedArchiveVideo[] {
  const root = requireRecord(payload, '投稿列表不是对象');
  const data = requireRecord(root.data, '投稿列表缺少 data');
  const list = requireRecord(data.list, '投稿列表缺少 list');
  const vlist = list.vlist;
  if (vlist === undefined || vlist === null) return [];
  if (!Array.isArray(vlist)) throw new Error('投稿列表 vlist 不是数组');
  const out: ParsedArchiveVideo[] = [];
  for (const item of vlist) {
    const row = requireRecord(item, '投稿条目不是对象');
    const bvid = optionalString(row.bvid);
    if (!bvid || !BVID.test(bvid)) throw new Error('投稿条目 bvid 非法');
    const title = optionalString(row.title) ?? '';
    const created = readNonNegative(row.created, 'created');
    let mid: string | null = null;
    if (row.mid !== undefined && row.mid !== null) {
      mid = readNonNegative(row.mid, 'mid').toString();
    }
    const pic = optionalString(row.pic);
    out.push({ bvid, title, created, mid, pic });
  }
  return out;
}

function dynamicTextFromModules(modules: Record<string, unknown> | null): string {
  if (!modules) return '';
  const dynamic = optionalRecord(modules.module_dynamic, 'module_dynamic');
  if (!dynamic) return '';
  const desc = optionalRecord(dynamic.desc, 'module_dynamic.desc');
  const fromDesc = desc ? optionalString(desc.text) : null;
  return fromDesc ? fromDesc.slice(0, 500) : '';
}

type MajorBvidCandidates = {
  keyed: string[];
  text: string[];
};

function collectMajorBvidCandidates(major: Record<string, unknown>): MajorBvidCandidates {
  const keyed: string[] = [];
  const text: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (depth > MAX_MAJOR_DEPTH) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (key.toLowerCase() === 'bvid') keyed.push(value);
        text.push(value);
      } else {
        walk(value, depth + 1);
      }
    }
  };

  walk(major, 0);
  return { keyed, text };
}

function firstValidBvid(values: string[]): string | null {
  for (const value of values) {
    const bvid = value.trim();
    if (BVID.test(bvid)) return bvid;
  }
  return null;
}

function firstBvidInText(values: string[]): string | null {
  for (const value of values) {
    const match = BVID_IN_TEXT.exec(value);
    if (match && BVID.test(match[0])) return match[0];
  }
  return null;
}

function dynamicBvidFromMajor(dynamic: Record<string, unknown>): string | null {
  const major = optionalRecord(dynamic.major, 'module_dynamic.major');
  if (!major) return null;
  const archive = optionalRecord(major.archive, 'module_dynamic.major.archive');
  const archiveBvid = archive ? optionalString(archive.bvid) : null;
  if (archiveBvid && BVID.test(archiveBvid)) return archiveBvid;
  const opus = optionalRecord(major.opus, 'module_dynamic.major.opus');
  const opusBvid = opus ? optionalString(opus.bvid) : null;
  if (opusBvid && BVID.test(opusBvid)) return opusBvid;
  const candidates = collectMajorBvidCandidates(major);
  return firstValidBvid(candidates.keyed) ?? firstBvidInText(candidates.text);
}

function collectDescJumpUrls(desc: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const direct = optionalString(desc.jump_url);
  if (direct) urls.push(direct);
  const nodes = desc.rich_text_nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) continue;
      const url = optionalString((node as Record<string, unknown>).jump_url);
      if (url) urls.push(url);
    }
  }
  return urls;
}

function dynamicBvidFromModules(modules: Record<string, unknown> | null): string | null {
  if (!modules) return null;
  const dynamic = optionalRecord(modules.module_dynamic, 'module_dynamic');
  if (!dynamic) return null;
  const majorBvid = dynamicBvidFromMajor(dynamic);
  if (majorBvid) return majorBvid;
  const desc = optionalRecord(dynamic.desc, 'module_dynamic.desc');
  if (!desc) return null;
  return firstBvidInText(collectDescJumpUrls(desc));
}

function dynamicTitleFromModules(modules: Record<string, unknown> | null): string {
  if (!modules) return '';
  const dynamic = optionalRecord(modules.module_dynamic, 'module_dynamic');
  if (!dynamic) return '';
  const desc = optionalRecord(dynamic.desc, 'module_dynamic.desc');
  const fromDesc = desc ? optionalString(desc.text) : null;
  if (fromDesc) return fromDesc.slice(0, 200);
  const major = optionalRecord(dynamic.major, 'module_dynamic.major');
  if (!major) return '';
  for (const key of ['archive', 'article', 'draw', 'opus', 'live_rcmd', 'pgc'] as const) {
    const node = optionalRecord(major[key], `major.${key}`);
    if (!node) continue;
    const title = optionalString(node.title) ?? optionalString(node.text);
    if (title) return title.slice(0, 200);
  }
  return '';
}

/** Charging / only_fans list cards — detail usually 500; skip rather than fail the round. */
export function isOnlyFansSpaceDynamicItem(row: Record<string, unknown>): boolean {
  const type = optionalString(row.type) ?? '';
  if (/only_?fans|ONLY_FANS|opusGoods|SUBSCRIPTION/i.test(type)) return true;
  const modules = optionalRecord(row.modules, 'modules');
  if (!modules) return false;
  const dynamic = optionalRecord(modules.module_dynamic, 'module_dynamic');
  if (!dynamic) return false;
  const major = optionalRecord(dynamic.major, 'module_dynamic.major');
  if (!major) return false;
  if ('only_fans' in major || 'onlyfans' in major) return true;
  const majorType = optionalString(major.type) ?? '';
  return /only_?fans|ONLY_FANS/i.test(majorType);
}

function peekDynamicId(row: Record<string, unknown>): string {
  const id = optionalString(row.id_str);
  return id && DYNAMIC_ID.test(id) ? id : '';
}

function parseOneSpaceDynamicItem(item: unknown): ParsedSpaceDynamic | DiscoveryItemSkip {
  try {
    const row = requireRecord(item, '动态条目不是对象');
    const id = optionalString(row.id_str);
    if (!id || !DYNAMIC_ID.test(id)) {
      return { externalId: peekDynamicId(row), reason: '动态 id_str 非法或缺失' };
    }
    if (isOnlyFansSpaceDynamicItem(row)) {
      return { externalId: id, reason: 'only_fans/充电专属动态（列表识别）' };
    }
    const modules = optionalRecord(row.modules, 'modules');
    const author = modules ? optionalRecord(modules.module_author, 'module_author') : null;
    if (!author || author.pub_ts === undefined || author.pub_ts === null) {
      return { externalId: id, reason: '动态缺少 module_author.pub_ts' };
    }
    const publishedAtSec = readNonNegative(author.pub_ts, 'module_author.pub_ts');
    const text = dynamicTextFromModules(modules);
    const title = dynamicTitleFromModules(modules);
    const bvid = dynamicBvidFromModules(modules);
    return {
      dynamicId: id,
      publishedAtSec,
      title,
      ...(text ? { text } : {}),
      ...(bvid ? { bvid } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '动态条目解析异常';
    let externalId = '';
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      externalId = peekDynamicId(item as Record<string, unknown>);
    }
    return { externalId, reason };
  }
}

export function parseSpaceDynamicFeed(payload: unknown): {
  items: ParsedSpaceDynamic[];
  skips: DiscoveryItemSkip[];
  offset: string | null;
  hasMore: boolean;
} {
  const root = requireRecord(payload, '空间动态不是对象');
  const data = requireRecord(root.data, '空间动态缺少 data');
  const rawItems = data.items;
  if (rawItems === undefined || rawItems === null) {
    return {
      items: [],
      skips: [],
      offset: optionalString(data.offset),
      hasMore: Boolean(data.has_more),
    };
  }
  if (!Array.isArray(rawItems)) throw new Error('空间动态 items 不是数组');
  const items: ParsedSpaceDynamic[] = [];
  const skips: DiscoveryItemSkip[] = [];
  for (const item of rawItems) {
    const parsed = parseOneSpaceDynamicItem(item);
    if ('dynamicId' in parsed) {
      items.push(parsed);
    } else {
      skips.push(parsed);
    }
  }
  return {
    items,
    skips,
    offset: optionalString(data.offset),
    hasMore: Boolean(data.has_more),
  };
}

/** Title for publish events: title → body first 40 → `动态 <id>`. */
export function resolveDiscoveryDynamicTitle(input: {
  title: string;
  text?: string | null;
  dynamicId: string;
}): string {
  const title = input.title.trim();
  if (title) return title.slice(0, 200);
  const text = (input.text ?? '').trim();
  if (text) return text.slice(0, 40);
  return `动态 ${input.dynamicId}`;
}
