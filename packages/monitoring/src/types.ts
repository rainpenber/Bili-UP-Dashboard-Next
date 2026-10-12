export type { ImportInventorySummary } from './inventory-summary';

export type FileKind =
  | 'follower'
  | 'views'
  | 'detailcount'
  | 'commentlist'
  | 'unknown_metric'
  | 'static_image'
  | 'static_json'
  | 'other';

export type InventoryEntry = {
  relativePath: string;
  mirror: 'backend' | 'frontend';
  sha256: string;
  kind: FileKind;
  entityKey: string | null;
  supported: boolean;
  note?: string;
};

export type ImportMode = 'inventory' | 'dry_run' | 'apply';

import type { ImportInventorySummary } from './inventory-summary';

export type ImportReport = {
  mode: ImportMode;
  sourceTimezone: string;
  importerVersion: string;
  fileCount: number;
  mirrorGroups: number;
  pathMirrorMismatches: number;
  canonicalGroups: number;
  /** Sum of physical CSV data rows across all metric files (both mirrors). */
  physicalMetricRows: number;
  parsed: number;
  accepted: number;
  rejected: number;
  /** Rows rejected due to invalid numeric cells (subset of rejected). */
  invalidNumeric: number;
  duplicate: number;
  conflict: number;
  pathDivergences: number;
  stagingRows: number;
  skippedAlreadyApplied: number;
  inventorySummary: ImportInventorySummary;
  unsupported: string[];
  entities: {
    creators: number;
    videos: number;
    dynamics: number;
  };
  timeCoverage: Record<string, { min: string | null; max: string | null }>;
  anomalies: string[];
  noOp: boolean;
};
