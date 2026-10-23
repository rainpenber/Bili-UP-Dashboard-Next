/**
 * 投稿列表 / 空间动态列表解析。
 * 端点与字段来自固定 commit 文档：
 * - reference/bilibili-api/space-arc-search.md → GET /x/space/wbi/arc/search
 * - reference/bilibili-api/space-dynamic-feed.md → GET /x/polymer/web-dynamic/v1/feed/space
 */

const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const DYNAMIC_ID = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;

export type ParsedArchiveVideo = {
  bvid: string;
  title: string;
  created: bigint;
  mid: string | null;
};

export type ParsedSpaceDynamic = {
  dynamicId: string;
  publishedAtSec: bigint;
  title: string;
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
    out.push({ bvid, title, created, mid });
  }
  return out;
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

export function parseSpaceDynamicFeed(payload: unknown): {
  items: ParsedSpaceDynamic[];
  offset: string | null;
  hasMore: boolean;
} {
  const root = requireRecord(payload, '空间动态不是对象');
  const data = requireRecord(root.data, '空间动态缺少 data');
  const rawItems = data.items;
  if (rawItems === undefined || rawItems === null) {
    return { items: [], offset: optionalString(data.offset), hasMore: Boolean(data.has_more) };
  }
  if (!Array.isArray(rawItems)) throw new Error('空间动态 items 不是数组');
  const items: ParsedSpaceDynamic[] = [];
  for (const item of rawItems) {
    const row = requireRecord(item, '动态条目不是对象');
    const id = optionalString(row.id_str);
    if (!id || !DYNAMIC_ID.test(id)) throw new Error('动态 id_str 非法');
    const modules = optionalRecord(row.modules, 'modules');
    const author = modules ? optionalRecord(modules.module_author, 'module_author') : null;
    if (!author || author.pub_ts === undefined || author.pub_ts === null) {
      throw new Error('动态缺少 module_author.pub_ts');
    }
    const publishedAtSec = readNonNegative(author.pub_ts, 'module_author.pub_ts');
    items.push({
      dynamicId: id,
      publishedAtSec,
      title: dynamicTitleFromModules(modules),
    });
  }
  return {
    items,
    offset: optionalString(data.offset),
    hasMore: Boolean(data.has_more),
  };
}
