export type ImportHttpMode = 'dry-run' | 'apply';

export type ImportCsvRequest = {
  mode: ImportHttpMode;
  sourceTimezone?: string;
};

export type ImportBatchStatus = 'running' | 'completed' | 'failed';

export type ImportBatchResponse = {
  batchId: string;
  status: ImportBatchStatus;
  mode: string;
  sourceTimezone: string;
  importerVersion: string | null;
  report: Record<string, unknown> | null;
  errorMessage: string | null;
  completedAt: string | null;
};

export function parseImportCsvRequest(body: unknown): ImportCsvRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('request body must be a JSON object');
  }
  const mode = (body as { mode?: unknown }).mode;
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error('mode must be dry-run or apply');
  }
  const sourceTimezone = (body as { sourceTimezone?: unknown }).sourceTimezone;
  if (sourceTimezone != null && typeof sourceTimezone !== 'string') {
    throw new Error('sourceTimezone must be a string');
  }
  return {
    mode,
    ...(sourceTimezone ? { sourceTimezone } : {}),
  };
}

export function mapHttpModeToImportMode(mode: ImportHttpMode): 'dry_run' | 'apply' {
  return mode === 'dry-run' ? 'dry_run' : 'apply';
}
