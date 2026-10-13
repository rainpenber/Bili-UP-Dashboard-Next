import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv-parse';
import type { InventoryResult } from './inventory';
import type { InventoryEntry } from './types';

export type MirrorInventoryProof = {
  pathsWithBothMirrors: number;
  exactSha256Matches: number;
  sha256Mismatches: number;
  backendOnlyPaths: number;
  frontendOnlyPaths: number;
  backendOnlyCommentlistFiles: number;
  frontendOnlyViewsFiles: number;
};

export type RootInventorySummary = {
  fileCount: number;
  filesByKind: Record<string, number>;
  physicalMetricRows: number;
};

export type ImportInventorySummary = {
  mockDataRoot: string;
  backend: RootInventorySummary;
  frontend: RootInventorySummary;
  assets: {
    mode: 'filesystem' | 'placeholder_only';
    fileCount: number;
    filesByKind: Record<string, number>;
  };
  mirrors: MirrorInventoryProof;
};

function countByKind(entries: InventoryEntry[]): Record<string, number> {
  const byKind: Record<string, number> = {};
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  return byKind;
}

export function countPhysicalMetricRows(root: string, entries: InventoryEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (!['follower', 'views', 'detailcount'].includes(entry.kind)) continue;
    try {
      const text = readFileSync(join(root, entry.relativePath), 'utf8');
      total += parseCsv(text).rows.length;
    } catch {
      continue;
    }
  }
  return total;
}

export function buildMirrorInventoryProof(inventory: InventoryResult): MirrorInventoryProof {
  let pathsWithBothMirrors = 0;
  let exactSha256Matches = 0;
  let sha256Mismatches = 0;
  let backendOnlyPaths = 0;
  let frontendOnlyPaths = 0;

  for (const row of inventory.pathMirrors) {
    if (row.backend && row.frontend) {
      pathsWithBothMirrors += 1;
      if (row.sha256Match === true) exactSha256Matches += 1;
      if (row.sha256Match === false) sha256Mismatches += 1;
    } else if (row.backend && !row.frontend) {
      backendOnlyPaths += 1;
    } else if (!row.backend && row.frontend) {
      frontendOnlyPaths += 1;
    }
  }

  const backendOnlyCommentlistFiles = inventory.backend.filter(
    (e) =>
      e.kind === 'commentlist' &&
      !inventory.frontend.some((f) => f.relativePath === e.relativePath),
  ).length;

  const frontendOnlyViewsFiles = inventory.frontend.filter(
    (e) => e.kind === 'views' && !inventory.backend.some((b) => b.relativePath === e.relativePath),
  ).length;

  return {
    pathsWithBothMirrors,
    exactSha256Matches,
    sha256Mismatches,
    backendOnlyPaths,
    frontendOnlyPaths,
    backendOnlyCommentlistFiles,
    frontendOnlyViewsFiles,
  };
}

export function buildImportInventorySummary(opts: {
  mockDataRoot: string;
  inventory: InventoryResult;
  backendRoot: string;
  frontendRoot: string;
  assetsMode: 'filesystem' | 'placeholder_only';
  assetsEntries: InventoryEntry[];
}): ImportInventorySummary {
  return {
    mockDataRoot: opts.mockDataRoot,
    backend: {
      fileCount: opts.inventory.backend.length,
      filesByKind: countByKind(opts.inventory.backend),
      physicalMetricRows: countPhysicalMetricRows(opts.backendRoot, opts.inventory.backend),
    },
    frontend: {
      fileCount: opts.inventory.frontend.length,
      filesByKind: countByKind(opts.inventory.frontend),
      physicalMetricRows: countPhysicalMetricRows(opts.frontendRoot, opts.inventory.frontend),
    },
    assets: {
      mode: opts.assetsMode,
      fileCount: opts.assetsEntries.length,
      filesByKind: countByKind(opts.assetsEntries),
    },
    mirrors: buildMirrorInventoryProof(opts.inventory),
  };
}
