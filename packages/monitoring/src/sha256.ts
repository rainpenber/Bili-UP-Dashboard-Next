export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexFile(path: string): Promise<string> {
  const file = Bun.file(path);
  const buf = new Uint8Array(await file.arrayBuffer());
  return sha256Hex(buf);
}
