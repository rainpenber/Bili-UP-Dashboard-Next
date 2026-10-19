const BILIBILI_HOST = /bilibili\.(com|tv)/i;

const guardFlag = Symbol.for('studio.offlineFetchGuard');

export function assertNoBilibiliNetwork(url: string): void {
  if (BILIBILI_HOST.test(url)) {
    throw new Error(`Blocked network access to Bilibili: ${url}`);
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Fail closed if offline code, or a test, issues any Bilibili request. */
export function installOfflineFetchGuard(): void {
  const marked = globalThis as typeof globalThis & { [guardFlag]?: boolean };
  if (marked[guardFlag]) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assertNoBilibiliNetwork(requestUrl(input));
    return original(input, init);
  }) as typeof fetch;
  marked[guardFlag] = true;
}
