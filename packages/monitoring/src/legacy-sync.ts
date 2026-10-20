import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acquireLegacySyncLock,
  countExistingFollowerSamples,
  countExistingVideoSamples,
  insertLegacyImportBatch,
  insertLegacyRejects,
  insertLegacySyncRound,
  listLegacyCheckpoints,
  readLegacyCheckpoint,
  writeLegacyCheckpoint,
  writeLegacyFollowerSamplesWithin,
  writeLegacyVideoSamplesWithin,
  type LegacyCheckpoint,
  type LegacyFollowerRow,
  type LegacySyncStatus,
  type LegacyVideoRow,
  type Sql,
} from '@studio/db';
import type { StudioLogger } from '@studio/observability';
import {
  classifyLegacyFile,
  expectedLegacyHeader,
  parseLegacyFollowerChunk,
  parseLegacyVideoChunk,
  type LegacyFileKind,
  type LegacyParseResult,
} from './legacy-import';
import { decodeLegacyHeader, PrefixHasher, takeCompleteLines } from './legacy-sync-bytes';

export const DEFAULT_LEGACY_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_LINES = 2000;
const READ_CHUNK = 64 * 1024;
const MAX_LINE_BYTES = 1_000_000;

export type LegacySyncFileAction = 'imported' | 'appended' | 'rescanned' | 'skipped' | 'failed';

export type LegacySyncFileReport = {
  file: string;
  action: LegacySyncFileAction;
  rowsParsed: number;
  inserted: number;
  conflicts: number;
  rejected: number;
  error: string | null;
};

export type LegacySyncRoundStatus = 'succeeded' | 'failed' | 'dry_run' | 'busy';

export type LegacySyncRoundReport = {
  status: LegacySyncRoundStatus;
  inserted: number;
  conflicts: number;
  rejected: number;
  rowsParsed: number;
  filesSeen: number;
  filesSkipped: number;
  filesFailed: number;
  durationMs: number;
  error: string | null;
  files: LegacySyncFileReport[];
  execute: boolean;
};

export type LegacySyncRunOptions = {
  sql: Sql;
  dir: string;
  execute: boolean;
  once?: boolean;
  intervalMs?: number;
  batchLines?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  logger?: StudioLogger | null;
  hooks?: {
    beforeBatchCommit?: (info: {
      file: string;
      byteOffset: number;
      batchIndex: number;
    }) => Promise<void> | void;
  };
  onParsed?: (info: { file: string; rows: number }) => void;
};

class LegacyFileFailure extends Error {
  constructor(message: string) {
    super(message);
  }
}

class SyncStopped extends Error {
  constructor() {
    super('stopped');
  }
}

type FileCounts = {
  rowsParsed: number;
  inserted: number;
  conflicts: number;
  rejected: number;
};

export function parseSyncInterval(raw: string): number {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(raw.trim());
  if (!match?.[1]) throw new Error('--interval 必须是正整数毫秒，或带 ms/s/m/h 后缀');
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--interval 必须是正整数毫秒，或带 ms/s/m/h 后缀');
  }
  const unit = match[2] ?? 'ms';
  const ms =
    unit === 'h'
      ? value * 3_600_000
      : unit === 'm'
        ? value * 60_000
        : unit === 's'
          ? value * 1000
          : value;
  if (ms > 24 * 3_600_000) throw new Error('--interval 不能超过 24 小时');
  return ms;
}

export function parseSyncBatchLines(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new Error('--batch-size 必须是 1 到 5000 的整数');
  }
  return value;
}

export function formatLegacySyncReport(report: LegacySyncRoundReport): string {
  const lines = [
    [
      `status=${report.status}`,
      `inserted=${report.inserted}`,
      `conflicts=${report.conflicts}`,
      `rejected=${report.rejected}`,
      `rows_parsed=${report.rowsParsed}`,
      `duration_ms=${report.durationMs}`,
      `files_seen=${report.filesSeen}`,
      `files_skipped=${report.filesSkipped}`,
      `files_failed=${report.filesFailed}`,
      `error=${report.error ?? '-'}`,
    ].join(' '),
  ];
  for (const file of report.files) {
    lines.push(
      [
        file.file,
        `action=${file.action}`,
        `rows_parsed=${file.rowsParsed}`,
        `inserted=${file.inserted}`,
        `conflicts=${file.conflicts}`,
        `rejected=${file.rejected}`,
        `error=${file.error ?? '-'}`,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

export function formatLegacySyncStatus(status: LegacySyncStatus): string {
  return [
    `status=${status.status}`,
    `inserted=${status.inserted}`,
    `conflicts=${status.conflicts}`,
    `rejected=${status.rejected}`,
    `duration_ms=${status.durationMs ?? '-'}`,
    `last_success_at=${status.lastSuccessAt ?? '-'}`,
    `files_seen=${status.filesSeen}`,
    `files_skipped=${status.filesSkipped}`,
    `files_failed=${status.filesFailed}`,
    `error=${status.error ?? '-'}`,
  ].join(' ');
}

function emptyReport(
  execute: boolean,
  status: LegacySyncRoundStatus,
  error: string | null,
): LegacySyncRoundReport {
  return {
    status,
    inserted: 0,
    conflicts: 0,
    rejected: 0,
    rowsParsed: 0,
    filesSeen: 0,
    filesSkipped: 0,
    filesFailed: status === 'failed' && error === 'snapshot_dir_missing' ? 1 : 0,
    durationMs: 0,
    error,
    files: [],
    execute,
  };
}

function isEnoent(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT',
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'legacy sync failed';
}

async function sleepInterruptible(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readFirstCompleteLine(filePath: string): Promise<Buffer | null> {
  const handle = await open(filePath, 'r');
  try {
    const parts: Buffer[] = [];
    let total = 0;
    let position = 0;
    const buf = Buffer.alloc(4096);
    while (total < MAX_LINE_BYTES) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      if (bytesRead === 0) return null;
      const slice = buf.subarray(0, bytesRead);
      const newline = slice.indexOf(0x0a);
      if (newline >= 0) {
        parts.push(Buffer.from(slice.subarray(0, newline + 1)));
        return Buffer.concat(parts);
      }
      parts.push(Buffer.from(slice));
      total += bytesRead;
      position += bytesRead;
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function hashFilePrefix(filePath: string, length: number): Promise<PrefixHasher | null> {
  const hasher = new PrefixHasher();
  if (length === 0) return hasher;
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(READ_CHUNK);
    let position = 0;
    let left = length;
    while (left > 0) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, left), position);
      if (bytesRead === 0) return null;
      hasher.update(buf.subarray(0, bytesRead));
      position += bytesRead;
      left -= bytesRead;
    }
    return hasher;
  } finally {
    await handle.close();
  }
}

type ReadPlan = {
  action: 'imported' | 'appended' | 'rescanned';
  start: number;
  hasher: PrefixHasher;
  headerLine: string;
};

async function planFile(
  filePath: string,
  kind: LegacyFileKind,
  size: number,
  checkpoint: LegacyCheckpoint | null,
): Promise<{ fail: string } | { skip: true } | { read: ReadPlan }> {
  const expected = expectedLegacyHeader(kind);
  const headerBytes = await readFirstCompleteLine(filePath);
  if (!headerBytes) return { fail: 'header_missing' };
  const headerLine = decodeLegacyHeader(headerBytes);
  if (headerLine !== expected || (checkpoint !== null && checkpoint.headerLine !== headerLine)) {
    return { fail: checkpoint ? 'header_changed' : 'header_invalid' };
  }
  if (!checkpoint) {
    return { read: { action: 'imported', start: 0, hasher: new PrefixHasher(), headerLine } };
  }
  if (size < checkpoint.byteOffset) {
    return { read: { action: 'rescanned', start: 0, hasher: new PrefixHasher(), headerLine } };
  }
  const hashed = await hashFilePrefix(filePath, checkpoint.byteOffset);
  const finger = hashed?.snapshot();
  const matches =
    hashed !== null &&
    finger !== undefined &&
    finger.prefixSha256 === checkpoint.prefixSha256 &&
    finger.boundarySha256 === checkpoint.boundarySha256 &&
    finger.boundaryLength === checkpoint.boundaryLength;
  if (!matches || !hashed) {
    return { read: { action: 'rescanned', start: 0, hasher: new PrefixHasher(), headerLine } };
  }
  if (size === checkpoint.byteOffset) return { skip: true };
  return { read: { action: 'appended', start: checkpoint.byteOffset, hasher: hashed, headerLine } };
}

function fileReport(
  file: string,
  action: LegacySyncFileAction,
  counts: FileCounts,
  error: string | null,
): LegacySyncFileReport {
  return { file, action, ...counts, error };
}

async function commitBatch(
  options: LegacySyncRunOptions,
  input: {
    file: string;
    kind: LegacyFileKind;
    entityKey: string;
    headerLine: string;
    action: ReadPlan['action'];
    newOffset: number;
    finger: ReturnType<PrefixHasher['snapshot']>;
    parsed: LegacyParseResult<LegacyVideoRow | LegacyFollowerRow>;
    batchIndex: number;
    seen: Set<number>;
  },
): Promise<{ inserted: number; conflicts: number }> {
  const { sql, execute, hooks } = options;
  const fresh: Array<LegacyVideoRow | LegacyFollowerRow> = [];
  let overlap = 0;
  for (const row of input.parsed.rows) {
    const at = row.sampledAt.getTime();
    if (input.seen.has(at)) overlap += 1;
    else {
      input.seen.add(at);
      fresh.push(row);
    }
  }
  const conflictsFor = (inserted: number) =>
    fresh.length + input.parsed.duplicates + overlap - inserted;
  if (!execute) {
    const times = fresh.map((row) => row.sampledAt);
    const existing =
      input.kind === 'video'
        ? await countExistingVideoSamples(sql, input.entityKey, times)
        : await countExistingFollowerSamples(sql, input.entityKey, times);
    const known = Math.min(fresh.length, existing);
    return { inserted: fresh.length - known, conflicts: conflictsFor(fresh.length - known) };
  }
  return sql.begin(async (tx) => {
    let inserted = 0;
    if (input.parsed.total > 0) {
      const batchId = crypto.randomUUID();
      await insertLegacyImportBatch(tx, {
        batchId,
        importerVersion: 'legacy-csv-sync',
        report: {
          file: input.file,
          rows: input.parsed.total,
          rejected: input.parsed.rejected,
          duplicates: input.parsed.duplicates,
          action: input.action,
        },
      });
      if (input.kind === 'video') {
        inserted = await writeLegacyVideoSamplesWithin(tx, {
          batchId,
          bvid: input.entityKey,
          rows: fresh.filter((row): row is LegacyVideoRow => 'viewCount' in row),
        });
      } else {
        inserted = await writeLegacyFollowerSamplesWithin(tx, {
          batchId,
          mid: input.entityKey,
          rows: fresh.filter((row): row is LegacyFollowerRow => 'followerCount' in row),
        });
      }
      if (input.parsed.rejections.length > 0) {
        await insertLegacyRejects(tx, {
          batchId,
          entityType: input.kind === 'video' ? 'video' : 'creator',
          entityKey: input.entityKey,
          lines: input.parsed.rejections,
        });
      }
    }
    await writeLegacyCheckpoint(tx, {
      relativePath: input.file,
      fileKind: input.kind,
      entityKey: input.entityKey,
      byteOffset: input.newOffset,
      prefixSha256: input.finger.prefixSha256,
      boundarySha256: input.finger.boundarySha256,
      boundaryLength: input.finger.boundaryLength,
      headerLine: input.headerLine,
    });
    if (hooks?.beforeBatchCommit) {
      await hooks.beforeBatchCommit({
        file: input.file,
        byteOffset: input.newOffset,
        batchIndex: input.batchIndex,
      });
    }
    return { inserted, conflicts: conflictsFor(inserted) };
  });
}

async function consumeFile(
  options: LegacySyncRunOptions,
  input: {
    filePath: string;
    file: string;
    kind: LegacyFileKind;
    entityKey: string;
    plan: ReadPlan;
    batchLines: number;
  },
): Promise<FileCounts> {
  const handle = await open(input.filePath, 'r');
  const counts: FileCounts = { rowsParsed: 0, inserted: 0, conflicts: 0, rejected: 0 };
  try {
    let carry = Buffer.alloc(0);
    let offset = input.plan.start;
    let position = input.plan.start;
    let eof = false;
    let headerPending = input.plan.start === 0;
    let batchIndex = 0;
    const seen = new Set<number>();
    while (!options.signal?.aborted) {
      const want = headerPending ? input.batchLines + 1 : input.batchLines;
      while (!eof && takeCompleteLines(carry, want).lines < want) {
        const buf = Buffer.alloc(READ_CHUNK);
        const { bytesRead } = await handle.read(buf, 0, buf.length, position);
        if (bytesRead === 0) {
          eof = true;
          break;
        }
        position += bytesRead;
        const piece = Buffer.from(buf.subarray(0, bytesRead));
        carry = carry.length === 0 ? piece : Buffer.concat([carry, piece]);
        if (carry.length > MAX_LINE_BYTES && takeCompleteLines(carry, 1).lines === 0) {
          throw new LegacyFileFailure(`line_too_long: ${input.file} 存在超过上限且没有换行的尾部`);
        }
      }
      const taken = takeCompleteLines(carry, want);
      if (taken.lines === 0) break;
      const committed = taken.done;
      let dataBytes = committed;
      if (headerPending) {
        const newline = committed.indexOf(0x0a);
        const actual = decodeLegacyHeader(committed.subarray(0, newline + 1));
        if (actual !== input.plan.headerLine) {
          throw new LegacyFileFailure(`header_changed: ${input.file} 表头已变化`);
        }
        dataBytes = committed.subarray(newline + 1);
        headerPending = false;
      }
      const dataText = dataBytes.toString('utf8');
      const parsed =
        dataText.length === 0
          ? {
              rows: [],
              rejected: 0,
              rejections: [] as string[],
              total: 0,
              earliest: null,
              latest: null,
              duplicates: 0,
            }
          : input.kind === 'video'
            ? parseLegacyVideoChunk(input.plan.headerLine, dataText)
            : parseLegacyFollowerChunk(input.plan.headerLine, dataText);
      if (parsed.total > 0) options.onParsed?.({ file: input.file, rows: parsed.total });
      input.plan.hasher.update(committed);
      const finger = input.plan.hasher.snapshot();
      const newOffset = offset + committed.length;
      batchIndex += 1;
      const written = await commitBatch(options, {
        file: input.file,
        kind: input.kind,
        entityKey: input.entityKey,
        headerLine: input.plan.headerLine,
        action: input.plan.action,
        newOffset,
        finger,
        parsed,
        batchIndex,
        seen,
      });
      counts.rowsParsed += parsed.total;
      counts.inserted += written.inserted;
      counts.conflicts += written.conflicts;
      counts.rejected += parsed.rejected;
      offset = newOffset;
      carry = Buffer.from(taken.rest);
    }
    if (options.signal?.aborted) throw new SyncStopped();
    return counts;
  } finally {
    await handle.close();
  }
}

async function syncOneFile(
  options: LegacySyncRunOptions,
  file: string,
  batchLines: number,
): Promise<LegacySyncFileReport> {
  const classified = classifyLegacyFile(file);
  if (!classified) {
    return fileReport(file, 'failed', zeroCounts(), `header_invalid: ${file} 不是旧 CSV`);
  }
  const filePath = join(options.dir, file);
  try {
    const info = await stat(filePath);
    const checkpoint = await readLegacyCheckpoint(options.sql, file);
    const plan = await planFile(filePath, classified.kind, info.size, checkpoint);
    if ('fail' in plan) {
      const detail =
        plan.fail === 'header_missing'
          ? `${plan.fail}: ${file} 缺少完整表头行`
          : plan.fail === 'header_changed'
            ? `${plan.fail}: ${file} 表头已变化`
            : `${plan.fail}: ${file} 表头无法识别`;
      return fileReport(file, 'failed', zeroCounts(), detail);
    }
    if ('skip' in plan) return fileReport(file, 'skipped', zeroCounts(), null);
    const counts = await consumeFile(options, {
      filePath,
      file,
      kind: classified.kind,
      entityKey: classified.entityKey,
      plan: plan.read,
      batchLines,
    });
    return fileReport(file, plan.read.action, counts, null);
  } catch (error) {
    if (error instanceof SyncStopped) throw error;
    if (error instanceof LegacyFileFailure)
      return fileReport(file, 'failed', zeroCounts(), error.message);
    if (isEnoent(error)) return fileReport(file, 'failed', zeroCounts(), `source_missing: ${file}`);
    throw error;
  }
}

function zeroCounts(): FileCounts {
  return { rowsParsed: 0, inserted: 0, conflicts: 0, rejected: 0 };
}

function summarize(
  files: LegacySyncFileReport[],
  execute: boolean,
  error: string | null,
  started: number,
): LegacySyncRoundReport {
  const rowsParsed = files.reduce((sum, file) => sum + file.rowsParsed, 0);
  const inserted = files.reduce((sum, file) => sum + file.inserted, 0);
  const conflicts = files.reduce((sum, file) => sum + file.conflicts, 0);
  const rejected = files.reduce((sum, file) => sum + file.rejected, 0);
  const filesFailed = files.filter((file) => file.action === 'failed').length;
  const filesSkipped = files.filter((file) => file.action === 'skipped').length;
  const failed = filesFailed > 0 || error !== null;
  return {
    status: failed ? 'failed' : execute ? 'succeeded' : 'dry_run',
    inserted,
    conflicts,
    rejected,
    rowsParsed,
    filesSeen: files.length,
    filesSkipped,
    filesFailed,
    durationMs: Date.now() - started,
    error,
    files,
    execute,
  };
}

async function persistRound(
  options: LegacySyncRunOptions,
  report: LegacySyncRoundReport,
  startedAt: Date,
): Promise<void> {
  if (!options.execute) return;
  if (report.status !== 'succeeded' && report.status !== 'failed') return;
  const finishedAt = new Date(startedAt.getTime() + report.durationMs);
  await insertLegacySyncRound(options.sql, {
    id: crypto.randomUUID(),
    status: report.status,
    startedAt,
    finishedAt,
    durationMs: report.durationMs,
    inserted: report.inserted,
    conflicts: report.conflicts,
    rejected: report.rejected,
    filesSeen: report.filesSeen,
    filesSkipped: report.filesSkipped,
    filesFailed: report.filesFailed,
    error: report.error,
    report: {
      files: report.files.map((file) => ({
        file: file.file,
        action: file.action,
        rowsParsed: file.rowsParsed,
        inserted: file.inserted,
        conflicts: file.conflicts,
        rejected: file.rejected,
        error: file.error,
      })),
    },
  });
  const event = report.status === 'succeeded' ? 'legacy.sync.finished' : 'legacy.sync.failed';
  options.logger?.info(report.status === 'succeeded' ? '旧 CSV 同步完成' : '旧 CSV 同步失败', {
    event,
    context: {
      status: report.status,
      inserted: report.inserted,
      conflicts: report.conflicts,
      rejected: report.rejected,
      durationMs: report.durationMs,
      filesSeen: report.filesSeen,
      filesSkipped: report.filesSkipped,
      filesFailed: report.filesFailed,
      lastSuccessAt: report.status === 'succeeded' ? finishedAt.toISOString() : null,
    },
  });
}

async function runRound(
  options: LegacySyncRunOptions,
  batchLines: number,
): Promise<LegacySyncRoundReport> {
  const startedAt = new Date();
  const started = startedAt.getTime();
  if (options.execute) {
    options.logger?.info('旧 CSV 同步开始', {
      event: 'legacy.sync.started',
      context: { execute: true },
    });
  }
  const files: LegacySyncFileReport[] = [];
  try {
    let dirStat;
    try {
      dirStat = await stat(options.dir);
    } catch (error) {
      if (isEnoent(error)) {
        const report = emptyReport(options.execute, 'failed', 'snapshot_dir_missing');
        report.durationMs = Date.now() - started;
        await persistRound(options, report, startedAt);
        return report;
      }
      throw error;
    }
    if (!dirStat.isDirectory()) {
      const report = emptyReport(options.execute, 'failed', 'snapshot_dir_missing');
      report.durationMs = Date.now() - started;
      await persistRound(options, report, startedAt);
      return report;
    }
    const entries = await readdir(options.dir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => classifyLegacyFile(name) !== null)
      .sort();
    for (const name of names) {
      if (options.signal?.aborted) throw new SyncStopped();
      files.push(await syncOneFile(options, name, batchLines));
    }
    const checkpoints = await listLegacyCheckpoints(options.sql);
    const present = new Set(names);
    for (const checkpoint of checkpoints) {
      if (!present.has(checkpoint.relativePath)) {
        files.push(
          fileReport(
            checkpoint.relativePath,
            'failed',
            zeroCounts(),
            `source_missing: ${checkpoint.relativePath}`,
          ),
        );
      }
    }
    const errors = files.flatMap((file) => (file.error ? [file.error] : []));
    const report = summarize(
      files,
      options.execute,
      errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
      started,
    );
    await persistRound(options, report, startedAt);
    return report;
  } catch (error) {
    const message = error instanceof SyncStopped ? 'stopped' : errorText(error);
    const report = summarize(files, options.execute, message, started);
    await persistRound(options, report, startedAt);
    return report;
  }
}

export async function runLegacyCsvSync(
  options: LegacySyncRunOptions,
): Promise<LegacySyncRoundReport> {
  const batchLines = options.batchLines ?? DEFAULT_BATCH_LINES;
  if (batchLines < 1 || batchLines > 5000) throw new Error('--batch-size 必须是 1 到 5000 的整数');
  const lock = await acquireLegacySyncLock(options.sql);
  if (!lock) return emptyReport(options.execute, 'busy', 'legacy sync already running');
  const intervalMs = options.intervalMs ?? DEFAULT_LEGACY_SYNC_INTERVAL_MS;
  try {
    let last = await runRound(options, batchLines);
    if (options.once !== false) return last;
    while (!options.signal?.aborted) {
      if (options.sleep) await options.sleep(intervalMs);
      else await sleepInterruptible(intervalMs, options.signal);
      if (options.signal?.aborted) break;
      last = await runRound(options, batchLines);
    }
    return last;
  } finally {
    await lock.release();
  }
}
