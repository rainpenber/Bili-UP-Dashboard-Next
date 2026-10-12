export function assetIdFromContentSha256(sha256: string): string {
  return `a_${sha256.slice(0, 24)}`;
}

export function guessMimeType(relativePath: string): string | null {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return null;
}
