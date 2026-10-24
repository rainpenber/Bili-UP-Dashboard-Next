import {
  collectorSchemaReady,
  createSql,
  legacySyncSchemaReady,
  readLegacySyncStatus,
  saveActiveBiliAccount,
} from '@studio/db';
import { createLogger } from '@studio/observability';
import {
  assertProviderCanStart,
  createLiveBilibiliTransport,
  createLiveImageTransport,
  DEFAULT_LEGACY_SYNC_INTERVAL_MS,
  encryptCookieJar,
  formatLegacyImportReport,
  formatLegacySyncReport,
  formatLegacySyncStatus,
  formatWebuiImportReport,
  importLegacyDirectory,
  importWebuiDirectory,
  loadCollectorSecretKey,
  parseSyncBatchLines,
  parseSyncInterval,
  readBilibiliRuntimeConfig,
  resolveMetadataIds,
  runLegacyCsvSync,
  runQrLogin,
  scrubCollectorError,
  startMetadataBackfill,
  type MetadataKind,
} from '@studio/monitoring';
import { renderLoginQr } from './qr-render';
import { waitForReady } from './wait-for-schema';

export type CollectorCli =
  | { command: 'login'; pngPath: string }
  | { command: 'import-legacy'; dir: string }
  | {
      command: 'sync-legacy';
      dir: string;
      once: boolean;
      execute: boolean;
      intervalMs: number;
      batchLines: number;
    }
  | { command: 'sync-legacy-status' }
  | { command: 'import-webui'; root: string; dryRun: boolean }
  | {
      command: 'fetch-metadata';
      kind: MetadataKind;
      bvid?: string;
      mid?: string;
      dir?: string;
      allMissing: boolean;
      limit: number | null;
      force: boolean;
      dryRun: boolean;
    };

function flagValue(rest: readonly string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  if (index < 0) return undefined;
  const value = rest[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`);
  return value;
}

const USAGE = [
  '用法:',
  '  login --qr [--png path]',
  '  import-legacy --dir <path>',
  '  sync-legacy --dir <path> [--once] [--execute | --dry-run] [--interval 15m] [--batch-size 2000]',
  '  sync-legacy status',
  '  import-webui --root <webui_meta> [--dry-run]',
  '  fetch metadata --kind video|creator (--bvid X | --mid X | --dir <webui_meta> | --all-missing) [--limit N] [--force] [--dry-run | --execute]',
].join('\n');

export function parseCollectorCli(argv: readonly string[]): CollectorCli {
  const [command, ...rest] = argv;
  if (command === 'login') {
    if (!rest.includes('--qr')) throw new Error('登录命令需要 --qr');
    const pngPath = flagValue(rest, '--png') ?? 'bilibili-login-qr.png';
    return { command: 'login', pngPath };
  }
  if (command === 'import-legacy') {
    const dir = flagValue(rest, '--dir');
    if (!dir) throw new Error('import-legacy 需要 --dir <path>');
    return { command: 'import-legacy', dir };
  }
  if (command === 'sync-legacy') {
    if (rest[0] === 'status') {
      if (rest.length !== 1) throw new Error('sync-legacy status 不接受其他参数');
      return { command: 'sync-legacy-status' };
    }
    const known = new Set([
      '--dir',
      '--once',
      '--execute',
      '--dry-run',
      '--interval',
      '--batch-size',
    ]);
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index] ?? '';
      if (!token.startsWith('--') || !known.has(token)) throw new Error(`无法识别的参数 ${token}`);
      if (token === '--dir' || token === '--interval' || token === '--batch-size') {
        const value = rest[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${token} 缺少参数`);
        index += 1;
      }
    }
    const dir = flagValue(rest, '--dir');
    if (!dir) throw new Error('sync-legacy 需要 --dir <path>');
    const intervalRaw = flagValue(rest, '--interval');
    const batchRaw = flagValue(rest, '--batch-size');
    return {
      command: 'sync-legacy',
      dir,
      once: rest.includes('--once'),
      execute: rest.includes('--execute') && !rest.includes('--dry-run'),
      intervalMs: intervalRaw ? parseSyncInterval(intervalRaw) : DEFAULT_LEGACY_SYNC_INTERVAL_MS,
      batchLines: batchRaw ? parseSyncBatchLines(batchRaw) : 2000,
    };
  }
  if (command === 'import-webui') {
    const root = flagValue(rest, '--root');
    if (!root) throw new Error('import-webui 需要 --root <webui_meta>');
    return { command: 'import-webui', root, dryRun: rest.includes('--dry-run') };
  }
  if (command === 'fetch' && rest[0] === 'metadata') {
    const args = rest.slice(1);
    const kind = flagValue(args, '--kind');
    if (kind !== 'video' && kind !== 'creator') {
      throw new Error('fetch metadata 需要 --kind video|creator');
    }
    const bvid = flagValue(args, '--bvid');
    const mid = flagValue(args, '--mid');
    const dir = flagValue(args, '--dir');
    const allMissing = args.includes('--all-missing');
    const selectors = [bvid, mid, dir, allMissing ? 'all' : undefined].filter(Boolean);
    if (selectors.length !== 1) {
      throw new Error('fetch metadata 需要且只能指定 --bvid、--mid、--dir 或 --all-missing 之一');
    }
    if (bvid && kind !== 'video') throw new Error('--bvid 只用于 --kind video');
    if (mid && kind !== 'creator') throw new Error('--mid 只用于 --kind creator');
    const limitRaw = flagValue(args, '--limit');
    let limit: number | null = null;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数');
    }
    const execute = args.includes('--execute');
    const dryFlag = args.includes('--dry-run');
    return {
      command: 'fetch-metadata',
      kind,
      ...(bvid ? { bvid } : {}),
      ...(mid ? { mid } : {}),
      ...(dir ? { dir } : {}),
      allMissing,
      limit,
      force: args.includes('--force'),
      dryRun: dryFlag || !execute,
    };
  }
  throw new Error(USAGE);
}

async function main(): Promise<void> {
  const parsed = parseCollectorCli(process.argv.slice(2));
  const sql = createSql();
  try {
    const schemaReady =
      parsed.command === 'sync-legacy' || parsed.command === 'sync-legacy-status'
        ? () => legacySyncSchemaReady(sql)
        : () => collectorSchemaReady(sql);
    await waitForReady(schemaReady, { attempts: 30, delayMs: 2_000 });
    if (parsed.command === 'sync-legacy-status') {
      console.log(formatLegacySyncStatus(await readLegacySyncStatus(sql)));
      return;
    }
    if (parsed.command === 'sync-legacy') {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      const logger = parsed.execute
        ? createLogger({
            service: 'collector',
            instance: process.env.COLLECTOR_INSTANCE_ID ?? 'legacy-sync',
            sql,
          })
        : null;
      try {
        const report = await runLegacyCsvSync({
          sql,
          dir: parsed.dir,
          execute: parsed.execute,
          once: parsed.once,
          intervalMs: parsed.intervalMs,
          batchLines: parsed.batchLines,
          signal: controller.signal,
          logger,
        });
        console.log(formatLegacySyncReport(report));
        if (report.status === 'failed' || report.status === 'busy') process.exitCode = 1;
        await logger?.flush();
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
      return;
    }
    if (parsed.command === 'import-legacy') {
      const report = await importLegacyDirectory(sql, parsed.dir);
      console.log(formatLegacyImportReport(report));
      return;
    }
    if (parsed.command === 'import-webui') {
      const logger = parsed.dryRun
        ? null
        : createLogger({
            service: 'collector',
            instance: process.env.COLLECTOR_INSTANCE_ID ?? 'import-webui',
            sql,
          });
      const report = await importWebuiDirectory({
        root: parsed.root,
        dryRun: parsed.dryRun,
        ...(parsed.dryRun ? {} : { sql, logger }),
        assetsRoot: process.env.MONITOR_ASSETS_ROOT ?? null,
      });
      console.log(formatWebuiImportReport(report));
      await logger?.flush();
      return;
    }
    if (parsed.command === 'fetch-metadata') {
      const ids = parsed.bvid ? [parsed.bvid] : parsed.mid ? [parsed.mid] : undefined;
      if (parsed.dryRun) {
        const plan = await resolveMetadataIds(sql, {
          kind: parsed.kind,
          ...(ids ? { ids } : {}),
          ...(parsed.dir ? { dir: parsed.dir } : {}),
          ...(parsed.allMissing ? { allMissing: true } : {}),
          limit: parsed.limit,
        });
        console.log(
          `metadata dry-run kind=${parsed.kind} mode=${plan.mode} requested=${plan.ids.length}`,
        );
        return;
      }
      const runtime = readBilibiliRuntimeConfig(process.env);
      const logger = createLogger({
        service: 'collector',
        instance: process.env.COLLECTOR_INSTANCE_ID ?? 'fetch-metadata',
        sql,
      });
      const started = await startMetadataBackfill(
        {
          sql,
          transport: createLiveBilibiliTransport(runtime.timeoutMs),
          download: createLiveImageTransport(runtime.timeoutMs),
          assetsRoot: process.env.MONITOR_ASSETS_ROOT ?? null,
          logger,
          env: process.env,
        },
        {
          kind: parsed.kind,
          ...(ids ? { ids } : {}),
          ...(parsed.dir ? { dir: parsed.dir } : {}),
          ...(parsed.allMissing ? { allMissing: true } : {}),
          limit: parsed.limit,
          force: parsed.force,
        },
      );
      console.log(`metadata backfill ${started.backfillRunId} requested=${started.requested}`);
      await started.done;
      await logger.flush();
      return;
    }
    assertProviderCanStart('bilibili', process.env);
    const key = loadCollectorSecretKey(process.env.COLLECTOR_SECRET_KEY);
    if (!key) throw new Error('COLLECTOR_SECRET_KEY 缺失，bilibili 模式拒绝启动');
    const runtime = readBilibiliRuntimeConfig(process.env);
    const logger = createLogger({
      service: 'collector',
      instance: process.env.COLLECTOR_INSTANCE_ID ?? 'collector-cli',
      sql,
    });
    const saved = await runQrLogin({
      transport: createLiveBilibiliTransport(runtime.timeoutMs),
      renderQr: (url) => renderLoginQr(url, parsed.pngPath),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
      logger,
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
    await logger.flush();
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
