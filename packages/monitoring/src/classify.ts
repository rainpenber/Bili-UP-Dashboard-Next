import type { FileKind } from './types';

const FOLLOWER = /^(\d+)_follower\.csv$/i;
const VIEWS = /^([A-Za-z0-9]+)_views\.csv$/i;
const DETAIL = /^(\d+)_detailcount\.csv$/i;
const COMMENT = /^commentlist/i;

export function classifyRelativePath(relativePath: string): {
  kind: FileKind;
  entityKey: string | null;
  supported: boolean;
  note?: string;
} {
  const base = relativePath.split(/[/\\]/).pop() ?? relativePath;
  if (COMMENT.test(base)) {
    return {
      kind: 'commentlist',
      entityKey: null,
      supported: false,
      note: 'unsupported/deferred: commentlist not in canonical model',
    };
  }
  const follower = base.match(FOLLOWER);
  if (follower) {
    return { kind: 'follower', entityKey: follower[1] ?? null, supported: true };
  }
  const views = base.match(VIEWS);
  if (views) {
    return { kind: 'views', entityKey: views[1] ?? null, supported: true };
  }
  const detail = base.match(DETAIL);
  if (detail) {
    return { kind: 'detailcount', entityKey: detail[1] ?? null, supported: true };
  }
  if (/\.(png|jpe?g|webp|gif)$/i.test(base)) {
    return { kind: 'static_image', entityKey: null, supported: true };
  }
  if (/\.json$/i.test(base)) {
    return { kind: 'static_json', entityKey: null, supported: true };
  }
  if (base.endsWith('.csv')) {
    return {
      kind: 'unknown_metric',
      entityKey: null,
      supported: false,
      note: 'unknown CSV schema',
    };
  }
  return { kind: 'other', entityKey: null, supported: false };
}
