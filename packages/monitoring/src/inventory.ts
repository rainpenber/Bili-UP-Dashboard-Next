import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRelativePath } from './classify';
import { sha256HexFile } from './sha256';
import type { InventoryEntry } from './types';

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop() ?? '';
    const abs = join(root, rel);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of entries) {
      const childRel = rel ? join(rel, name) : name;
      const childAbs = join(root, childRel);
      const st = statSync(childAbs);
      if (st.isDirectory()) {
        stack.push(childRel);
      } else if (st.isFile()) {
        out.push(childRel.replace(/\\/g, '/'));
      }
    }
  }
  return out.sort();
}

export async function scanMirrorRoot(
  root: string,
  mirror: 'backend' | 'frontend',
): Promise<InventoryEntry[]> {
  const files = walkFiles(root);
  const entries: InventoryEntry[] = [];
  for (const relativePath of files) {
    const classification = classifyRelativePath(relativePath);
    const sha256 = await sha256HexFile(join(root, relativePath));
    entries.push({
      relativePath,
      mirror,
      sha256,
      kind: classification.kind,
      entityKey: classification.entityKey,
      supported: classification.supported,
      ...(classification.note ? { note: classification.note } : {}),
    });
  }
  return entries;
}

export type PathMirrorReport = {
  relativePath: string;
  backend?: InventoryEntry;
  frontend?: InventoryEntry;
  sha256Match: boolean | null;
};

/** Same basename path across mirrors (may differ in hash). */
export function buildPathMirrorReports(
  backend: InventoryEntry[],
  frontend: InventoryEntry[],
): PathMirrorReport[] {
  const byPath = new Map<string, PathMirrorReport>();
  for (const entry of backend) {
    byPath.set(entry.relativePath, {
      relativePath: entry.relativePath,
      backend: entry,
      sha256Match: null,
    });
  }
  for (const entry of frontend) {
    const existing = byPath.get(entry.relativePath);
    if (!existing) {
      byPath.set(entry.relativePath, {
        relativePath: entry.relativePath,
        frontend: entry,
        sha256Match: null,
      });
      continue;
    }
    existing.frontend = entry;
    existing.sha256Match = existing.backend?.sha256 === entry.sha256;
  }
  return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export type CanonicalContentGroup = {
  fileKind: string;
  entityKey: string;
  contentSha256: string;
  sources: InventoryEntry[];
};

/** Canonical grouping by content hash + metric kind + entity (not path alone). */
export function buildCanonicalContentGroups(allEntries: InventoryEntry[]): CanonicalContentGroup[] {
  const map = new Map<string, CanonicalContentGroup>();
  for (const entry of allEntries) {
    if (!entry.entityKey) continue;
    if (!['follower', 'views', 'detailcount'].includes(entry.kind)) continue;
    const key = `${entry.kind}|${entry.entityKey}|${entry.sha256}`;
    const existing = map.get(key);
    if (existing) {
      existing.sources.push(entry);
      continue;
    }
    map.set(key, {
      fileKind: entry.kind,
      entityKey: entry.entityKey,
      contentSha256: entry.sha256,
      sources: [entry],
    });
  }
  return [...map.values()].sort((a, b) =>
    `${a.fileKind}|${a.entityKey}|${a.contentSha256}`.localeCompare(
      `${b.fileKind}|${b.entityKey}|${b.contentSha256}`,
    ),
  );
}

export type InventoryResult = {
  backend: InventoryEntry[];
  frontend: InventoryEntry[];
  pathMirrors: PathMirrorReport[];
  canonicalGroups: CanonicalContentGroup[];
  unsupported: InventoryEntry[];
};

export async function runInventory(opts: {
  backendRoot?: string;
  frontendRoot?: string;
}): Promise<InventoryResult> {
  const backend = opts.backendRoot ? await scanMirrorRoot(opts.backendRoot, 'backend') : [];
  const frontend = opts.frontendRoot ? await scanMirrorRoot(opts.frontendRoot, 'frontend') : [];
  const pathMirrors = buildPathMirrorReports(backend, frontend);
  const canonicalGroups = buildCanonicalContentGroups([...backend, ...frontend]);
  const unsupported = [...backend, ...frontend].filter((e) => !e.supported);
  return { backend, frontend, pathMirrors, canonicalGroups, unsupported };
}
