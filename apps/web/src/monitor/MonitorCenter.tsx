import { useEffect, useMemo, useState } from 'react';
import type { CreatorListItem, DynamicListItem, VideoListItem } from '@studio/contracts';
import {
  fetchCreators,
  fetchCreatorMetrics,
  fetchDynamics,
  fetchDynamicMetrics,
  fetchVideoMetrics,
  fetchVideos,
  formatCount,
} from './api';
import { MetricCharts } from './MetricCharts';

type Tab = 'videos' | 'creators' | 'dynamics';

type LoadState<T> =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: T };

const PLACEHOLDER_COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect fill="#1e293b" width="100%" height="100%"/><text x="50%" y="50%" fill="#94a3b8" font-size="12" text-anchor="middle" dy=".3em">无封面</text></svg>',
  );

export function MonitorCenter() {
  const [tab, setTab] = useState<Tab>('videos');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [videos, setVideos] = useState<LoadState<{ items: VideoListItem[]; totalPages: number }>>({
    kind: 'loading',
  });
  const [creators, setCreators] = useState<
    LoadState<{ items: CreatorListItem[]; totalPages: number }>
  >({
    kind: 'loading',
  });
  const [dynamics, setDynamics] = useState<
    LoadState<{ items: DynamicListItem[]; totalPages: number }>
  >({
    kind: 'loading',
  });
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [selectedDynamic, setSelectedDynamic] = useState<string | null>(null);
  const [metricsState, setMetricsState] = useState<LoadState<unknown>>({ kind: 'loading' });

  useEffect(() => {
    setPage(1);
  }, [tab, category, q]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setVideos({ kind: 'loading' });
      try {
        const data = await fetchVideos({
          page,
          ...(category ? { category } : {}),
          ...(q ? { q } : {}),
        });
        if (!cancelled)
          setVideos({ kind: 'ready', data: { items: data.items, totalPages: data.totalPages } });
      } catch (err) {
        if (!cancelled)
          setVideos({ kind: 'error', message: err instanceof Error ? err.message : '加载失败' });
      }
    }
    if (tab === 'videos') void load();
    return () => {
      cancelled = true;
    };
  }, [tab, page, category, q]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setCreators({ kind: 'loading' });
      try {
        const data = await fetchCreators({ page, ...(q ? { q } : {}) });
        if (!cancelled)
          setCreators({ kind: 'ready', data: { items: data.items, totalPages: data.totalPages } });
      } catch (err) {
        if (!cancelled)
          setCreators({ kind: 'error', message: err instanceof Error ? err.message : '加载失败' });
      }
    }
    if (tab === 'creators') void load();
    return () => {
      cancelled = true;
    };
  }, [tab, page, q]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDynamics({ kind: 'loading' });
      try {
        const data = await fetchDynamics({ page });
        if (!cancelled)
          setDynamics({ kind: 'ready', data: { items: data.items, totalPages: data.totalPages } });
      } catch (err) {
        if (!cancelled)
          setDynamics({ kind: 'error', message: err instanceof Error ? err.message : '加载失败' });
      }
    }
    if (tab === 'dynamics') void load();
    return () => {
      cancelled = true;
    };
  }, [tab, page]);

  useEffect(() => {
    let cancelled = false;
    async function loadMetrics() {
      setMetricsState({ kind: 'loading' });
      try {
        if (tab === 'videos' && selectedVideo) {
          const data = await fetchVideoMetrics(selectedVideo);
          if (!cancelled)
            setMetricsState({ kind: 'ready', data: { kind: 'video', points: data.items } });
          return;
        }
        if (tab === 'creators' && selectedCreator) {
          const data = await fetchCreatorMetrics(selectedCreator);
          if (!cancelled)
            setMetricsState({ kind: 'ready', data: { kind: 'creator', points: data.items } });
          return;
        }
        if (tab === 'dynamics' && selectedDynamic) {
          const data = await fetchDynamicMetrics(selectedDynamic);
          if (!cancelled)
            setMetricsState({ kind: 'ready', data: { kind: 'dynamic', points: data.items } });
          return;
        }
        if (!cancelled) setMetricsState({ kind: 'ready', data: null });
      } catch (err) {
        if (!cancelled)
          setMetricsState({
            kind: 'error',
            message: err instanceof Error ? err.message : '指标加载失败',
          });
      }
    }
    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [tab, selectedVideo, selectedCreator, selectedDynamic]);

  const totalPages = useMemo(() => {
    if (tab === 'videos' && videos.kind === 'ready') return videos.data.totalPages;
    if (tab === 'creators' && creators.kind === 'ready') return creators.data.totalPages;
    if (tab === 'dynamics' && dynamics.kind === 'ready') return dynamics.data.totalPages;
    return 1;
  }, [tab, videos, creators, dynamics]);

  return (
    <section className="monitor">
      <header className="monitor-header">
        <h2>B 站监控中心（Mock）</h2>
        <p className="muted">数据来自离线 CSV 导入 · 不访问 B 站接口</p>
        <nav className="tabs" aria-label="监控视图">
          {(['videos', 'creators', 'dynamics'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'tab active' : 'tab'}
              onClick={() => setTab(t)}
            >
              {t === 'videos' ? '视频' : t === 'creators' ? 'UP 主' : '动态'}
            </button>
          ))}
        </nav>
        <div className="filters">
          {tab === 'videos' && (
            <label>
              分类
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="可选"
              />
            </label>
          )}
          {(tab === 'videos' || tab === 'creators') && (
            <label>
              关键词
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="标题 / ID" />
            </label>
          )}
        </div>
      </header>

      <div className="monitor-body">
        <div className="card-grid" aria-live="polite">
          {tab === 'videos' && videos.kind === 'loading' && <p>加载中…</p>}
          {tab === 'videos' && videos.kind === 'error' && (
            <p className="health-error">{videos.message}</p>
          )}
          {tab === 'videos' &&
            videos.kind === 'ready' &&
            videos.data.items.map((v) => (
              <button
                type="button"
                key={v.bvid}
                className={selectedVideo === v.bvid ? 'entity-card selected' : 'entity-card'}
                onClick={() => setSelectedVideo(v.bvid)}
              >
                <img src={PLACEHOLDER_COVER} alt="" width={160} height={90} />
                <div className="entity-meta">
                  <strong>{v.title ?? v.bvid}</strong>
                  <span className="muted">{v.category ?? '未分类'}</span>
                  <span className="muted">
                    更新 {v.latestMetrics.sampledAt ?? '—'} · 播放{' '}
                    {formatCount(v.latestMetrics.viewCount, v.latestMetrics.onlineViewersRaw)}
                  </span>
                </div>
              </button>
            ))}

          {tab === 'creators' && creators.kind === 'loading' && <p>加载中…</p>}
          {tab === 'creators' && creators.kind === 'error' && (
            <p className="health-error">{creators.message}</p>
          )}
          {tab === 'creators' &&
            creators.kind === 'ready' &&
            creators.data.items.map((c) => (
              <button
                type="button"
                key={c.mid}
                className={selectedCreator === c.mid ? 'entity-card selected' : 'entity-card'}
                onClick={() => setSelectedCreator(c.mid)}
              >
                <img src={PLACEHOLDER_COVER} alt="" width={64} height={64} />
                <div className="entity-meta">
                  <strong>{c.uname ?? c.mid}</strong>
                  <span className="muted">粉丝 {formatCount(c.latestMetrics.followerCount)}</span>
                </div>
              </button>
            ))}

          {tab === 'dynamics' && dynamics.kind === 'loading' && <p>加载中…</p>}
          {tab === 'dynamics' && dynamics.kind === 'error' && (
            <p className="health-error">{dynamics.message}</p>
          )}
          {tab === 'dynamics' &&
            dynamics.kind === 'ready' &&
            dynamics.data.items.map((d) => (
              <button
                type="button"
                key={d.dynamicId}
                className={selectedDynamic === d.dynamicId ? 'entity-card selected' : 'entity-card'}
                onClick={() => setSelectedDynamic(d.dynamicId)}
              >
                <div className="entity-meta">
                  <strong>{d.dynamicId}</strong>
                  <span className="muted">
                    赞 {formatCount(d.latestMetrics.likeCount)} · 评{' '}
                    {formatCount(d.latestMetrics.commentCount)}
                  </span>
                </div>
              </button>
            ))}
        </div>

        <footer className="pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </footer>

        <section className="card chart-panel">
          <h3>时序指标</h3>
          {metricsState.kind === 'loading' && <p>加载指标…</p>}
          {metricsState.kind === 'error' && <p className="health-error">{metricsState.message}</p>}
          {metricsState.kind === 'ready' && metricsState.data == null && (
            <p className="muted">请选择左侧卡片查看趋势</p>
          )}
          {metricsState.kind === 'ready' &&
            metricsState.data != null &&
            (metricsState.data as { kind: string }).kind === 'video' && (
              <MetricCharts kind="video" points={(metricsState.data as { points: never }).points} />
            )}
          {metricsState.kind === 'ready' &&
            metricsState.data != null &&
            (metricsState.data as { kind: string }).kind === 'creator' && (
              <MetricCharts
                kind="creator"
                points={(metricsState.data as { points: never }).points}
              />
            )}
          {metricsState.kind === 'ready' &&
            metricsState.data != null &&
            (metricsState.data as { kind: string }).kind === 'dynamic' && (
              <MetricCharts
                kind="dynamic"
                points={(metricsState.data as { points: never }).points}
              />
            )}
        </section>
      </div>
    </section>
  );
}
