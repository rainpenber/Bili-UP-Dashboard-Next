import type { ImportReport } from './types';

export function reportToMarkdown(report: ImportReport): string {
  const lines = [
    `# Import report (${report.mode})`,
    '',
    `- Source timezone: ${report.sourceTimezone}`,
    `- Files: ${report.fileCount}`,
    `- Mirror groups (by path): ${report.mirrorGroups}`,
    `- Path mirror hash mismatches: ${report.pathMirrorMismatches}`,
    `- Canonical content groups: ${report.canonicalGroups}`,
    `- Physical metric rows: ${report.physicalMetricRows}`,
    `- Importer version: ${report.importerVersion}`,
    `- Staging rows: ${report.stagingRows}`,
    `- Skipped (already applied): ${report.skippedAlreadyApplied}`,
    `- Parsed rows: ${report.parsed}`,
    `- Accepted: ${report.accepted}`,
    `- Rejected: ${report.rejected}`,
    `- Invalid numeric: ${report.invalidNumeric}`,
    `- Duplicate: ${report.duplicate}`,
    `- Conflict: ${report.conflict}`,
    `- Path divergences: ${report.pathDivergences}`,
    `- No-op re-run: ${report.noOp}`,
    '',
    '## Inventory proof',
    `- Backend files: ${report.inventorySummary.backend.fileCount} (physical metric rows: ${report.inventorySummary.backend.physicalMetricRows})`,
    `- Frontend files: ${report.inventorySummary.frontend.fileCount} (physical metric rows: ${report.inventorySummary.frontend.physicalMetricRows})`,
    `- Assets mode: ${report.inventorySummary.assets.mode} (${report.inventorySummary.assets.fileCount} files)`,
    `- Mirror SHA matches: ${report.inventorySummary.mirrors.exactSha256Matches}`,
    `- Mirror SHA mismatches: ${report.inventorySummary.mirrors.sha256Mismatches}`,
    `- Backend-only paths: ${report.inventorySummary.mirrors.backendOnlyPaths}`,
    `- Frontend-only paths: ${report.inventorySummary.mirrors.frontendOnlyPaths}`,
    `- Backend-only commentlist: ${report.inventorySummary.mirrors.backendOnlyCommentlistFiles}`,
    `- Frontend-only views: ${report.inventorySummary.mirrors.frontendOnlyViewsFiles}`,
    '',
    '## Entities',
    `- Creators: ${report.entities.creators}`,
    `- Videos: ${report.entities.videos}`,
    `- Dynamics: ${report.entities.dynamics}`,
    '',
    '## Time coverage',
  ];
  for (const [k, v] of Object.entries(report.timeCoverage)) {
    lines.push(`- ${k}: ${v.min ?? '—'} → ${v.max ?? '—'}`);
  }
  if (report.unsupported.length > 0) {
    lines.push('', '## Unsupported / deferred', ...report.unsupported.map((u) => `- ${u}`));
  }
  if (report.anomalies.length > 0) {
    lines.push('', '## Anomalies', ...report.anomalies.map((a) => `- ${a}`));
  }
  return lines.join('\n');
}
