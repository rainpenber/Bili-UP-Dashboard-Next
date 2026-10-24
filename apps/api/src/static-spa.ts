import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Context, Hono, Next } from 'hono';

/**
 * Hashed Vite assets never change under the same name, so they can be cached
 * forever. index.html must not be cached: it is the only pointer to the
 * current asset hashes, and a stale copy keeps loading an old bundle long
 * after a deploy.
 */
const ASSET_CACHE = 'public, max-age=31536000, immutable';
const SHELL_CACHE = 'no-store, must-revalidate';

/** Serves Vite build output; API and /health must be registered before this. */
export function registerWebSpa(app: Hono, root: string): void {
  if (!existsSync(join(root, 'index.html'))) {
    console.warn(`WEB_STATIC_ROOT missing index.html at ${root}; SPA routes disabled`);
    return;
  }

  const serveAsset = serveStatic({ root });
  const serveShell = serveStatic({ root, path: 'index.html' });

  app.use('/assets/*', async (c: Context, next: Next) => {
    await serveAsset(c, next);
    if (c.res.status === 200) {
      c.header('Cache-Control', ASSET_CACHE);
    }
  });

  const shell = async (c: Context, next: Next) => {
    await serveShell(c, next);
    if (c.res.status === 200) {
      c.header('Cache-Control', SHELL_CACHE);
    }
  };

  app.get('/', shell);
  app.get('*', (c: Context, next: Next) => {
    const path = c.req.path;
    if (path.startsWith('/api') || path === '/health') {
      return next();
    }
    return shell(c, next);
  });
}

export function resolveWebStaticRoot(): string | null {
  const root = process.env.WEB_STATIC_ROOT?.trim();
  return root && root.length > 0 ? root : null;
}
