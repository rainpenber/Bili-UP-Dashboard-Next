import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  applyLegacyFollowerImport,
  applyLegacyVideoImport,
  type LegacyFollowerRow,
  type LegacyVideoRow,
  type Sql,
} from '@studio/db';
import { parseBoundedCount, parseCsv, parseIntegerField } from './csv-parse';
import { parseHistoricalTime } from './time';

const VIDEO_FILE = /^(BV[1-9A-HJ-NP-Za-km-z]{10})_views\.csv$/;
const FOLLOWER_FILE = /^([1-9][0-9]{0,18})_follower\.csv$/;
const ZONE = 'Asia/Shanghai';

export type LegacyFileReport = {
  file: string;
  rows: number;
  inserted: number;
  conflicts: number;
  rejected: number;
};

export type LegacyImportReport = {
  files: LegacyFileReport[];
  earliest: string | null;
  latest: string | null;
};

type Accepted<T> = { row: T; at: number };

function dedupe<T>(rows: Accepted<T>[]): { unique: T[]; duplicates: number } {
  const seen = new Map<number, T>();
  let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.at)) duplicates += 1;
    else seen.set(row.at, row.row);
  }
  return { unique: [...seen.values()], duplicates };
}

function cell(row: string[], index: number): string {
  return row[index] ?? '';
}

export function parseLegacyVideoCsv(text: string): {
  rows: LegacyVideoRow[];
  rejected: number;
  total: number;
  earliest: Date | null;
  latest: Date | null;
  duplicates: number;
} {
  const parsed = parseCsv(text);
  let rejected = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  const accepted: Accepted<LegacyVideoRow>[] = [];
  for (const row of parsed.rows) {
    const rawTime = cell(row, 0).trim();
    const sampledAt = parseHistoricalTime(rawTime, ZONE, 'minute');
    const viewCount = parseIntegerField(cell(row, 1));
    const online = parseBoundedCount(cell(row, 2));
    const likeCount = parseIntegerField(cell(row, 3));
    const coinCount = parseIntegerField(cell(row, 4));
    const favoriteCount = parseIntegerField(cell(row, 5));
    const shareCount = parseIntegerField(cell(row, 6));
    const danmakuCount = parseIntegerField(cell(row, 7));
    if (
      !sampledAt ||
      viewCount === null ||
      online.value === null ||
      likeCount === null ||
      coinCount === null ||
      favoriteCount === null ||
      shareCount === null ||
      danmakuCount === null
    ) {
      rejected += 1;
      continue;
    }
    if (!earliest || sampledAt < earliest) earliest = sampledAt;
    if (!latest || sampledAt > latest) latest = sampledAt;
    accepted.push({
      at: sampledAt.getTime(),
      row: {
        sampledAt,
        rawTime,
        viewCount,
        onlineViewers: online.value,
        onlineViewersRaw: online.raw,
        likeCount,
        coinCount,
        favoriteCount,
        shareCount,
        danmakuCount,
      },
    });
  }
  const deduped = dedupe(accepted);
  return {
    rows: deduped.unique,
    rejected,
    total: parsed.rows.length,
    earliest,
    latest,
    duplicates: deduped.duplicates,
  };
}

export function parseLegacyFollowerCsv(text: string): {
  rows: LegacyFollowerRow[];
  rejected: number;
  total: number;
  earliest: Date | null;
  latest: Date | null;
  duplicates: number;
} {
  const parsed = parseCsv(text);
  let rejected = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  const accepted: Accepted<LegacyFollowerRow>[] = [];
  for (const row of parsed.rows) {
    const rawTime = cell(row, 0).trim();
    const sampledAt = parseHistoricalTime(rawTime, ZONE, 'minute');
    const followerCount = parseIntegerField(cell(row, 1));
    if (!sampledAt || followerCount === null) {
      rejected += 1;
      continue;
    }
    if (!earliest || sampledAt < earliest) earliest = sampledAt;
    if (!latest || sampledAt > latest) latest = sampledAt;
    accepted.push({
      at: sampledAt.getTime(),
      row: { sampledAt, rawTime, followerCount },
    });
  }
  const deduped = dedupe(accepted);
  return {
    rows: deduped.unique,
    rejected,
    total: parsed.rows.length,
    earliest,
    latest,
    duplicates: deduped.duplicates,
  };
}

function consider(range: { earliest: Date | null; latest: Date | null }, at: Date | null): void {
  if (!at) return;
  if (!range.earliest || at < range.earliest) range.earliest = at;
  if (!range.latest || at > range.latest) range.latest = at;
}

export async function importLegacyDirectory(sql: Sql, dir: string): Promise<LegacyImportReport> {
  const names = readdirSync(dir).filter(
    (name) => VIDEO_FILE.test(name) || FOLLOWER_FILE.test(name),
  );
  names.sort();
  const files: LegacyFileReport[] = [];
  const range: { earliest: Date | null; latest: Date | null } = { earliest: null, latest: null };
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8');
    const video = VIDEO_FILE.exec(basename(name));
    if (video) {
      const bvid = video[1];
      if (!bvid) continue;
      const parsed = parseLegacyVideoCsv(text);
      consider(range, parsed.earliest);
      consider(range, parsed.latest);
      const batchId = crypto.randomUUID();
      const inserted = await applyLegacyVideoImport(sql, {
        batchId,
        bvid,
        rows: parsed.rows,
        report: {
          file: name,
          rows: parsed.total,
          rejected: parsed.rejected,
          duplicates: parsed.duplicates,
        },
      });
      const conflicts = parsed.rows.length + parsed.duplicates - inserted;
      files.push({
        file: name,
        rows: parsed.total,
        inserted,
        conflicts,
        rejected: parsed.rejected,
      });
      continue;
    }
    const follower = FOLLOWER_FILE.exec(basename(name));
    const mid = follower?.[1];
    if (!mid) continue;
    const parsed = parseLegacyFollowerCsv(text);
    consider(range, parsed.earliest);
    consider(range, parsed.latest);
    const batchId = crypto.randomUUID();
    const inserted = await applyLegacyFollowerImport(sql, {
      batchId,
      mid,
      rows: parsed.rows,
      report: {
        file: name,
        rows: parsed.total,
        rejected: parsed.rejected,
        duplicates: parsed.duplicates,
      },
    });
    files.push({
      file: name,
      rows: parsed.total,
      inserted,
      conflicts: parsed.rows.length + parsed.duplicates - inserted,
      rejected: parsed.rejected,
    });
  }
  return {
    files,
    earliest: range.earliest?.toISOString() ?? null,
    latest: range.latest?.toISOString() ?? null,
  };
}

export function formatLegacyImportReport(report: LegacyImportReport): string {
  const lines = report.files.map(
    (file) =>
      `${file.file} 行数=${file.rows} 入库=${file.inserted} 冲突=${file.conflicts} 拒绝=${file.rejected}`,
  );
  lines.push(`最早 sampled_at=${report.earliest ?? '-'}`);
  lines.push(`最晚 sampled_at=${report.latest ?? '-'}`);
  return lines.join('\n');
}
