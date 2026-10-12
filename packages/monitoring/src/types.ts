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

export type MirrorGroup = {
  relativePath: string;
  backend?: InventoryEntry;
  frontend?: InventoryEntry;
  sha256Match: boolean | null;
  canonicalSha256: string | null;
};

export type ImportMode = 'inventory' | 'dry_run' | 'apply';

export type ImportReport = {
  mode: ImportMode;
  sourceTimezone: string;
  fileCount: number;
  mirrorGroups: number;
  parsed: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  conflict: number;
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
