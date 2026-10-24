import { STORAGE_KEY, setDraftStorageForTests, type DraftStorage } from './storage';

/** 内存草稿存储：可配置 getItem 抛错，并记录 setItem 写入 */
export function createMemoryDraftStorage(options?: {
  initial?: Record<string, string>;
  throwOnGetKey?: string;
}): DraftStorage & { writes: string[]; raw: Record<string, string> } {
  const raw: Record<string, string> = { ...(options?.initial ?? {}) };
  const writes: string[] = [];
  const throwOnGetKey = options?.throwOnGetKey;
  return {
    raw,
    writes,
    getItem(key: string) {
      if (throwOnGetKey && key === throwOnGetKey) throw new Error('blocked read');
      return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key]! : null;
    },
    setItem(key: string, value: string) {
      if (key === STORAGE_KEY) writes.push(value);
      raw[key] = value;
    },
    removeItem(key: string) {
      delete raw[key];
    },
  };
}

export function useDraftStorageForTest(storage: DraftStorage | null): () => void {
  setDraftStorageForTests(storage);
  return () => setDraftStorageForTests(null);
}
