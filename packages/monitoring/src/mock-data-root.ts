import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type MockDataLayout = {
  root: string;
  backendRoot: string;
  frontendRoot: string;
  assetsRoot: string;
};

export function resolveMockDataLayout(env: NodeJS.ProcessEnv = process.env): MockDataLayout {
  const root = env.MOCK_DATA_ROOT?.trim();
  if (!root) {
    throw new Error('MOCK_DATA_ROOT is not configured');
  }
  const abs = resolve(root);
  const backendRoot = join(abs, 'backend');
  const frontendRoot = join(abs, 'frontend');
  const assetsRoot = join(abs, 'assets');
  if (!existsSync(backendRoot) && !existsSync(frontendRoot)) {
    throw new Error(
      `MOCK_DATA_ROOT must contain backend/ and/or frontend/ subdirectories (got ${abs})`,
    );
  }
  return {
    root: abs,
    backendRoot: existsSync(backendRoot) ? backendRoot : frontendRoot,
    frontendRoot: existsSync(frontendRoot) ? frontendRoot : backendRoot,
    assetsRoot: existsSync(assetsRoot) ? assetsRoot : join(frontendRoot, 'meta'),
  };
}
