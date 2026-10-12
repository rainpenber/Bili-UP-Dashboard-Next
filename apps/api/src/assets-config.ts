import { resolve } from 'node:path';

/** Root directory for serving registered static assets (relative paths only in DB). */
export function readAssetsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.MONITOR_ASSETS_ROOT ?? env.MONITOR_FRONTEND_DATA_ROOT ?? env.MONITOR_FRONTEND_MOUNT ?? null;
  if (!raw || raw.trim() === '') return null;
  return resolve(raw);
}
