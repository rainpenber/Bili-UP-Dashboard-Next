import { collectorSchemaReady, createSql, saveActiveBiliAccount } from '@studio/db';
import {
  assertProviderCanStart,
  createLiveBilibiliTransport,
  encryptCookieJar,
  formatLegacyImportReport,
  importLegacyDirectory,
  loadCollectorSecretKey,
  readBilibiliRuntimeConfig,
  runQrLogin,
  scrubCollectorError,
} from '@studio/monitoring';
import { renderLoginQr } from './qr-render';
import { waitForReady } from './wait-for-schema';

export type CollectorCli =
  { command: 'login'; pngPath: string } | { command: 'import-legacy'; dir: string };

export function parseCollectorCli(argv: readonly string[]): CollectorCli {
  const [command, ...rest] = argv;
  if (command === 'login') {
    if (!rest.includes('--qr')) throw new Error('登录命令需要 --qr');
    const pngFlag = rest.indexOf('--png');
    const pngPath = pngFlag >= 0 ? rest[pngFlag + 1] : 'bilibili-login-qr.png';
    if (!pngPath) throw new Error('缺少二维码 PNG 路径');
    return { command: 'login', pngPath };
  }
  if (command === 'import-legacy') {
    const dirFlag = rest.indexOf('--dir');
    const dir = dirFlag >= 0 ? rest[dirFlag + 1] : undefined;
    if (!dir) throw new Error('import-legacy 需要 --dir <path>');
    return { command: 'import-legacy', dir };
  }
  throw new Error('用法: login --qr [--png path] | import-legacy --dir <path>');
}

async function main(): Promise<void> {
  const parsed = parseCollectorCli(process.argv.slice(2));
  const sql = createSql();
  try {
    await waitForReady(() => collectorSchemaReady(sql), { attempts: 30, delayMs: 2_000 });
    if (parsed.command === 'import-legacy') {
      const report = await importLegacyDirectory(sql, parsed.dir);
      console.log(formatLegacyImportReport(report));
      return;
    }
    assertProviderCanStart('bilibili', process.env);
    const key = loadCollectorSecretKey(process.env.COLLECTOR_SECRET_KEY);
    if (!key) throw new Error('COLLECTOR_SECRET_KEY 缺失，bilibili 模式拒绝启动');
    const runtime = readBilibiliRuntimeConfig(process.env);
    const saved = await runQrLogin({
      transport: createLiveBilibiliTransport(runtime.timeoutMs),
      renderQr: (url) => renderLoginQr(url, parsed.pngPath),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
      save: async (profile) => {
        const secret = encryptCookieJar(profile.jar, key);
        return saveActiveBiliAccount(sql, {
          id: crypto.randomUUID(),
          mid: profile.mid,
          uname: profile.uname,
          avatarUrl: profile.face,
          cookieExpiresAt: profile.cookieExpiresAt,
          secret,
        });
      },
    });
    console.log(`账号已保存 ${saved.accountId}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(scrubCollectorError(error));
    process.exitCode = 1;
  });
}
