import { useEffect, useState } from 'react';
import { parseHealthResponse, type HealthResponse } from '@studio/contracts';

const DEFAULT_API_HEALTH_URL = import.meta.env.VITE_API_HEALTH_URL ?? '/api/health';

type HealthView =
  | { kind: 'loading' }
  | { kind: 'ready'; data: HealthResponse }
  | { kind: 'error'; message: string };

export function App() {
  const [health, setHealth] = useState<HealthView>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const res = await fetch(DEFAULT_API_HEALTH_URL);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json: unknown = await res.json();
        const data = parseHealthResponse(json);
        if (!cancelled) {
          setHealth({ kind: 'ready', data });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (!cancelled) {
          setHealth({ kind: 'error', message });
        }
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Studio Ops Hub</h1>
      <p className="tagline">
        三人自媒体工作室 · 商单制作、流程督导与 B 站账号监控（Bootstrap WP-000）
      </p>
      <section className="card" aria-live="polite">
        <h2>API 健康状态</h2>
        {health.kind === 'loading' && <p>正在检测…</p>}
        {health.kind === 'error' && (
          <p className="health-error">
            无法连接 API：{health.message}（本地请先启动 <code>apps/api</code>）
          </p>
        )}
        {health.kind === 'ready' && (
          <>
            <p className="health-ok">状态：{health.data.status}</p>
            <p className="health-meta">
              服务 {health.data.service} · 版本 {health.data.version}
            </p>
            <p className="health-meta">时间 {health.data.timestamp}</p>
          </>
        )}
      </section>
    </main>
  );
}
