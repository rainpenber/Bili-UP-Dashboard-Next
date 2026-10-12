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
    `- Importer version: ${report.importerVersion}`,
    `- Staging rows: ${report.stagingRows}`,
    `- Skipped (already applied): ${report.skippedAlreadyApplied}`,
    `- Parsed rows: ${report.parsed}`,
    `- Accepted: ${report.accepted}`,
    `- Rejected: ${report.rejected}`,
    `- Duplicate: ${report.duplicate}`,
    `- Conflict: ${report.conflict}`,
    `- No-op re-run: ${report.noOp}`,
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
