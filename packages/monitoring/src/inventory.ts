import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRelativePath } from './classify';
import { sha256HexFile } from './sha256';
import type { InventoryEntry, MirrorGroup } from './types';

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

export function buildMirrorGroups(
  backend: InventoryEntry[],
  frontend: InventoryEntry[],
): MirrorGroup[] {
  const byPath = new Map<string, MirrorGroup>();
  for (const entry of backend) {
    byPath.set(entry.relativePath, {
      relativePath: entry.relativePath,
      backend: entry,
      sha256Match: null,
      canonicalSha256: entry.sha256,
    });
  }
  for (const entry of frontend) {
    const existing = byPath.get(entry.relativePath);
    if (!existing) {
      byPath.set(entry.relativePath, {
        relativePath: entry.relativePath,
        frontend: entry,
        sha256Match: null,
        canonicalSha256: entry.sha256,
      });
      continue;
    }
    existing.frontend = entry;
    existing.sha256Match = existing.backend?.sha256 === entry.sha256;
    existing.canonicalSha256 = existing.backend?.sha256 ?? entry.sha256;
  }
  return [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export type InventoryResult = {
  backend: InventoryEntry[];
  frontend: InventoryEntry[];
  groups: MirrorGroup[];
  unsupported: InventoryEntry[];
};

export async function runInventory(opts: {
  backendRoot?: string;
  frontendRoot?: string;
}): Promise<InventoryResult> {
  const backend = opts.backendRoot ? await scanMirrorRoot(opts.backendRoot, 'backend') : [];
  const frontend = opts.frontendRoot ? await scanMirrorRoot(opts.frontendRoot, 'frontend') : [];
  const groups = buildMirrorGroups(backend, frontend);
  const unsupported = [...backend, ...frontend].filter((e) => !e.supported);
  return { backend, frontend, groups, unsupported };
}
