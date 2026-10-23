/**
 * WP-R2-26D: per-item dynamic enrichment for discovery.
 * List success = round success. Detail is at most one attempt per candidate;
 * only_fans / 500 / -352 / parse errors become skips; other detail failures
 * degrade to list fields when id + pub time are present.
 */

import type { UpstreamCall } from './bilibili-failure';
import { BilibiliFailure } from './bilibili-failure';
import type { DiscoveryItemSkip, ParsedSpaceDynamic } from './bilibili-discovery-parse';
import { resolveDiscoveryDynamicTitle } from './bilibili-discovery-parse';
import { scrubCollectorError } from './credentials';

export type DiscoveryDynamicDetail = {
  title: string | null;
  text: string | null;
  calls: UpstreamCall[];
};

export type DiscoveryDynamicDetailFetcher = (dynamicId: string) => Promise<DiscoveryDynamicDetail>;

/** Failures that must not create events and must not fail the round. */
export function isIsolatedDiscoveryDetailFailure(error: unknown): boolean {
  if (error instanceof BilibiliFailure) {
    if (error.bizCode === 500 || error.bizCode === -352) return true;
    if (error.kind === 'risk_control' && error.endpoint === 'dynamic_detail') return true;
  }
  const message = scrubCollectorError(error);
  const lower = message.toLowerCase();
  if (lower.includes('only_fans') || lower.includes('onlyfans')) return true;
  if (/业务码\s*-352\b/.test(message) || /(?<![0-9])-352(?![0-9])/.test(message)) return true;
  if (/业务码\s*500\b/.test(message)) return true;
  return false;
}

function skipReasonFromDetailError(error: unknown): string {
  const message = scrubCollectorError(error);
  if (/only_fans|onlyfans/i.test(message)) {
    return message.includes('业务码') ? message : `only_fans/充电专属：${message}`;
  }
  return message.slice(0, 500) || '动态详情失败';
}

/**
 * Enrich list dynamics with at most one detail call per candidate.
 * Non-candidates are passed through unchanged (no extra upstream calls).
 */
export async function enrichDiscoveryDynamics(input: {
  listItems: readonly ParsedSpaceDynamic[];
  listSkips?: readonly DiscoveryItemSkip[];
  /** When true, attempt one detail fetch for this item. */
  shouldEnrich: (item: ParsedSpaceDynamic) => boolean;
  fetchDetail: DiscoveryDynamicDetailFetcher | null;
}): Promise<{
  dynamics: ParsedSpaceDynamic[];
  skips: DiscoveryItemSkip[];
  calls: UpstreamCall[];
}> {
  const skips: DiscoveryItemSkip[] = [...(input.listSkips ?? [])];
  const dynamics: ParsedSpaceDynamic[] = [];
  const calls: UpstreamCall[] = [];

  for (const item of input.listItems) {
    if (!input.fetchDetail || !input.shouldEnrich(item)) {
      dynamics.push({
        ...item,
        title: resolveDiscoveryDynamicTitle({
          title: item.title,
          text: item.text ?? null,
          dynamicId: item.dynamicId,
        }),
      });
      continue;
    }

    try {
      const detail = await input.fetchDetail(item.dynamicId);
      calls.push(...detail.calls);
      const mergedText = detail.text ?? item.text ?? null;
      const title = resolveDiscoveryDynamicTitle({
        title: detail.title?.trim() || item.title,
        text: mergedText,
        dynamicId: item.dynamicId,
      });
      dynamics.push({
        dynamicId: item.dynamicId,
        publishedAtSec: item.publishedAtSec,
        title,
        ...(mergedText ? { text: mergedText.slice(0, 500) } : {}),
      });
    } catch (error) {
      if (error instanceof BilibiliFailure) {
        calls.push(...error.calls);
      }
      if (isIsolatedDiscoveryDetailFailure(error)) {
        skips.push({
          externalId: item.dynamicId,
          reason: skipReasonFromDetailError(error),
        });
        continue;
      }
      // Degrade: list already has id + publish time — keep the event.
      dynamics.push({
        ...item,
        title: resolveDiscoveryDynamicTitle({
          title: item.title,
          text: item.text ?? null,
          dynamicId: item.dynamicId,
        }),
      });
    }
  }

  return { dynamics, skips, calls };
}
