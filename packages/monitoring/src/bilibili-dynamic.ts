/**
 * 单条动态详情解析。字段只来自固定文档里的当前条目：
 * `data.item.id_str`、`modules.module_stat`，以及条目上确实存在的作者/正文。
 * 不读取 `basic.comment_id_str`、`basic.rid_str`、`major.draw.id` 或 `orig`。
 */

const DYNAMIC_ID = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;

export type ParsedDynamicDetail = {
  dynamicId: string;
  dynamicType: string | null;
  visible: boolean | null;
  authorMid: string | null;
  authorName: string | null;
  faceUrl: string | null;
  publishedAt: Date | null;
  publishedText: string | null;
  text: string | null;
  majorType: string | null;
  likeCount: bigint | null;
  commentCount: bigint | null;
  repostCount: bigint | null;
};

export function assertDynamicId(dynamicId: string): string {
  if (typeof dynamicId !== 'string' || !DYNAMIC_ID.test(dynamicId)) {
    throw new Error('动态 id 必须是十进制整数字符串');
  }
  return dynamicId;
}

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

function requireDynamicIdString(value: unknown): string {
  if (value === undefined || value === null) throw new Error('动态详情缺少 id_str');
  if (typeof value !== 'string' || !DYNAMIC_ID.test(value)) {
    throw new Error('动态详情的 id_str 必须是十进制整数字符串');
  }
  return value;
}

function readOptionalMid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return readNonNegative(value, 'module_author.mid').toString();
}

function readPublishedAt(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const seconds = readNonNegative(value, 'module_author.pub_ts');
  const millis = seconds * 1000n;
  if (millis > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('module_author.pub_ts 超出安全时间范围');
  }
  return new Date(Number(millis));
}

function readStatCount(
  stat: Record<string, unknown> | null,
  key: 'like' | 'comment' | 'forward',
): bigint | null {
  if (!stat || !(key in stat)) return null;
  const node = optionalRecord(stat[key], `module_stat.${key}`);
  if (!node || !('count' in node)) return null;
  const count = node.count;
  if (count === undefined || count === null) return null;
  return readNonNegative(count, `module_stat.${key}.count`);
}

export function parseDynamicDetail(payload: unknown, dynamicId: string): ParsedDynamicDetail {
  const expected = assertDynamicId(dynamicId);
  const root = requireRecord(payload, '动态详情不是对象');
  const item = requireRecord(
    requireRecord(root.data, '动态详情缺少 data').item,
    '动态详情缺少 item',
  );
  const actual = requireDynamicIdString(item.id_str);
  if (actual !== expected) throw new Error('动态 id 与请求不一致');

  const modules = optionalRecord(item.modules, 'modules');
  const author = modules ? optionalRecord(modules.module_author, 'module_author') : null;
  const dynamic = modules ? optionalRecord(modules.module_dynamic, 'module_dynamic') : null;
  const stat = modules ? optionalRecord(modules.module_stat, 'module_stat') : null;
  const desc = dynamic ? optionalRecord(dynamic.desc, 'module_dynamic.desc') : null;
  const major = dynamic ? optionalRecord(dynamic.major, 'module_dynamic.major') : null;

  return {
    dynamicId: actual,
    dynamicType: optionalString(item.type),
    visible: item.visible === true || item.visible === false ? item.visible : null,
    authorMid: author ? readOptionalMid(author.mid) : null,
    authorName: author ? optionalString(author.name) : null,
    faceUrl: author ? optionalString(author.face) : null,
    publishedAt: author ? readPublishedAt(author.pub_ts) : null,
    publishedText: author ? optionalString(author.pub_time) : null,
    text: desc ? optionalString(desc.text) : null,
    majorType: major ? optionalString(major.type) : null,
    likeCount: readStatCount(stat, 'like'),
    commentCount: readStatCount(stat, 'comment'),
    repostCount: readStatCount(stat, 'forward'),
  };
}
