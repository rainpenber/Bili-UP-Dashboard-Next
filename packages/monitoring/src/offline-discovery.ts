import type { UpstreamCall } from './bilibili-failure';
import type { ParsedArchiveVideo, ParsedSpaceDynamic } from './bilibili-discovery-parse';
import type { DiscoveryListProvider } from './discovery-job';
import { installOfflineFetchGuard } from './network-guard';

export type OfflineDiscoveryFixture = {
  videosByMid?: Record<string, ParsedArchiveVideo[]>;
  dynamicsByMid?: Record<string, ParsedSpaceDynamic[]>;
  /** When set, fetch throws BilibiliFailure-like errors via this factory. */
  fail?: (kind: 'archives' | 'dynamics') => Error;
};

/**
 * Deterministic discovery lists for MONITOR_PROVIDER=offline / unit tests.
 * Always installs the offline fetch guard so discovery never hits bilibili.com.
 */
export function createOfflineDiscoveryProvider(
  fixture: OfflineDiscoveryFixture = {},
): DiscoveryListProvider {
  installOfflineFetchGuard();
  return {
    async fetchCreatorArchives(input) {
      if (fixture.fail) throw fixture.fail('archives');
      const calls: UpstreamCall[] = [
        {
          endpoint: 'space_arc_search',
          statusCode: 200,
          bizCode: 0,
          durationMs: 1,
          error: null,
        },
      ];
      const all = fixture.videosByMid?.[input.mid] ?? [];
      const pn = input.pn ?? 1;
      const ps = input.ps ?? 30;
      const start = Math.max(0, (pn - 1) * ps);
      const videos = all.slice(start, start + ps);
      return {
        videos,
        calls,
        page: { pn, ps, count: all.length },
      };
    },
    async fetchCreatorDynamics(input) {
      if (fixture.fail) throw fixture.fail('dynamics');
      const calls: UpstreamCall[] = [
        {
          endpoint: 'space_dynamic_feed',
          statusCode: 200,
          bizCode: 0,
          durationMs: 1,
          error: null,
        },
      ];
      return {
        dynamics: fixture.dynamicsByMid?.[input.mid] ?? [],
        calls,
      };
    },
  };
}
