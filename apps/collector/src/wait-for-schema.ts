export async function waitForReady(
  probe: () => Promise<boolean>,
  options: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (await probe()) return;
    if (attempt === options.attempts) break;
    await sleep(options.delayMs);
  }
  throw new Error('采集表尚未就绪。迁移只由 API 执行，collector 不会自行建表。');
}
