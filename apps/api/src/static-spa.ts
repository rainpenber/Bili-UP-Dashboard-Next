import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';

/** Serves Vite build output; API and /health must be registered before this. */
export function registerWebSpa(app: Hono, root: string): void {
  if (!existsSync(join(root, 'index.html'))) {
    console.warn(`WEB_STATIC_ROOT missing index.html at ${root}; SPA routes disabled`);
    return;
  }

  app.use('/assets/*', serveStatic({ root }));
  app.get('/', (c, next) => serveStatic({ root, path: 'index.html' })(c, next));
  app.get('*', (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api') || path === '/health') {
      return next();
    }
    return serveStatic({ root, path: 'index.html' })(c, next);
  });
}

export function resolveWebStaticRoot(): string | null {
  const root = process.env.WEB_STATIC_ROOT?.trim();
  return root && root.length > 0 ? root : null;
}
