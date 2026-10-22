/**
 * 测试用：从 Storage.prototype 恢复 localStorage 方法，避免用例间 mock 泄漏。
 * 不依赖 Object.getPrototypeOf(localStorage)（CI happy-dom 上可能无 getItem）。
 */
const protoGetItem = Storage.prototype.getItem;
const protoSetItem = Storage.prototype.setItem;
const protoRemoveItem = Storage.prototype.removeItem;

export function restoreLocalStorageMethods(): void {
  if (typeof localStorage === 'undefined') return;
  if (typeof protoGetItem !== 'function') return;
  Object.defineProperty(localStorage, 'getItem', {
    configurable: true,
    writable: true,
    value: protoGetItem.bind(localStorage),
  });
  Object.defineProperty(localStorage, 'setItem', {
    configurable: true,
    writable: true,
    value: protoSetItem.bind(localStorage),
  });
  Object.defineProperty(localStorage, 'removeItem', {
    configurable: true,
    writable: true,
    value: protoRemoveItem.bind(localStorage),
  });
}

/** 仅对本工具 key 让 getItem 抛错；setItem 仍可用。返回卸载函数。 */
export function installGetItemThrowForKey(key: string): () => void {
  Object.defineProperty(localStorage, 'getItem', {
    configurable: true,
    writable: true,
    value(k: string) {
      if (k === key) throw new Error('blocked read');
      return protoGetItem.call(localStorage, k);
    },
  });
  return () => restoreLocalStorageMethods();
}

/** 记录对本工具 key 的 setItem 写入；返回 { writes, uninstall }。 */
export function installSetItemCaptureForKey(key: string): {
  writes: string[];
  uninstall: () => void;
} {
  const writes: string[] = [];
  Object.defineProperty(localStorage, 'setItem', {
    configurable: true,
    writable: true,
    value(k: string, value: string) {
      if (k === key) writes.push(value);
      return protoSetItem.call(localStorage, k, value);
    },
  });
  return {
    writes,
    uninstall: () => restoreLocalStorageMethods(),
  };
}

export function readViaStoragePrototype(key: string): string | null {
  return protoGetItem.call(localStorage, key);
}
