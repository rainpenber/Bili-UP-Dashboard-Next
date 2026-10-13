import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type AssetsMode = 'filesystem' | 'placeholder_only';

export type MockDataLayout = {
  root: string;
  backendRoot: string;
  frontendRoot: string;
  /** Null when assets/ is missing — API serves placeholders only. */
  assetsRoot: string | null;
  assetsMode: AssetsMode;
};

/**
 * Deployment contract: MOCK_DATA_ROOT contains backend/, frontend/, and optionally assets/.
 * Example: MOCK_DATA_ROOT=/mock-data → /mock-data/backend, /mock-data/frontend, /mock-data/assets.
 */
export function resolveMockDataLayout(env: NodeJS.ProcessEnv = process.env): MockDataLayout {
  const root = env.MOCK_DATA_ROOT?.trim();
  if (!root) {
    throw new Error('MOCK_DATA_ROOT is not configured');
  }
  const abs = resolve(root);
  const backendRoot = join(abs, 'backend');
  const frontendRoot = join(abs, 'frontend');
  const assetsDir = join(abs, 'assets');

  if (!existsSync(backendRoot)) {
    throw new Error(`MOCK_DATA_ROOT must contain backend/ subdirectory (got ${abs})`);
  }
  if (!existsSync(frontendRoot)) {
    throw new Error(`MOCK_DATA_ROOT must contain frontend/ subdirectory (got ${abs})`);
  }

  const assetsPresent = existsSync(assetsDir);
  return {
    root: abs,
    backendRoot,
    frontendRoot,
    assetsRoot: assetsPresent ? assetsDir : null,
    assetsMode: assetsPresent ? 'filesystem' : 'placeholder_only',
  };
}
