export const IMPORTER_VERSION = 'wp-001.2.0';

export function canonicalSourceKey(parts: {
  fileKind: string;
  entityKey: string;
  contentSha256: string;
}): string {
  return `${parts.fileKind}|${parts.entityKey}|${parts.contentSha256}`;
}
