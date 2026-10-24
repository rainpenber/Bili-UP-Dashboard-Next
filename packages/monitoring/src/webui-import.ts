import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '@studio/db';
import type { StudioLogger } from '@studio/observability';
import type postgres from 'postgres';
import { sniffImage, storeImageBytes, type ImageMime } from './image-asset';

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const MID = /^[1-9][0-9]{0,18}$/;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export const WEBUI_IMPORTER_VERSION = 'webui-meta';

export type WebuiImportReport = {
  dryRun: boolean;
  videos: number;
  creators: number;
  images: number;
  missingImages: number;
  batchId: string | null;
};

type VideoEntry = {
  bvid: string;
  title: string | null;
  category: string | null;
  views: unknown;
};

type CreatorEntry = {
  mid: string;
  uname: string | null;
  category: string | null;
  followers: unknown;
  lastUpdate: unknown;
};

function readJson(path: string): unknown {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function categoryOf(record: Record<string, unknown>): string | null {
  return textOrNull(record.catagory);
}

function findImage(root: string, folder: string, stem: string): string | null {
  for (const ext of IMAGE_EXTS) {
    const absolute = join(root, folder, `${stem}${ext}`);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

function parseVideos(root: string): VideoEntry[] {
  const value = readJson(join(root, 'videos.json'));
  if (!Array.isArray(value)) throw new Error('videos.json 必须是数组');
  const videos: VideoEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const bvid = record ? textOrNull(record.bvid) : null;
    if (!record || !bvid || !BVID.test(bvid)) continue;
    videos.push({
      bvid,
      title: textOrNull(record.title),
      category: categoryOf(record),
      views: record.views ?? null,
    });
  }
  return videos;
}

function parseCreators(root: string): CreatorEntry[] {
  const value = readJson(join(root, 'creators.json'));
  if (!Array.isArray(value)) throw new Error('creators.json 必须是数组');
  const creators: CreatorEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const midRaw = record?.mid;
    const mid =
      typeof midRaw === 'number' && Number.isFinite(midRaw)
        ? Math.trunc(midRaw).toString()
        : typeof midRaw === 'string'
          ? midRaw.trim()
          : null;
    if (!record || !mid || !MID.test(mid)) continue;
    creators.push({
      mid,
      uname: textOrNull(record.name),
      category: categoryOf(record),
      followers: record.followers ?? null,
      lastUpdate: record.lastUpdate ?? null,
    });
  }
  return creators;
}

function countImages(root: string, videos: VideoEntry[], creators: CreatorEntry[]): number {
  let images = 0;
  for (const video of videos) {
    if (findImage(root, 'videos', `${video.bvid}_cover`)) images += 1;
  }
  for (const creator of creators) {
    if (findImage(root, 'creators', `${creator.mid}_avatar`)) images += 1;
  }
  return images;
}

export function readWebuiIds(root: string, kind: 'video' | 'creator'): string[] {
  if (kind === 'video') return parseVideos(root).map((video) => video.bvid);
  return parseCreators(root).map((creator) => creator.mid);
}

export function formatWebuiImportReport(report: WebuiImportReport): string {
  const mode = report.dryRun ? 'dry-run' : 'applied';
  const batch = report.batchId ? ` batch=${report.batchId}` : '';
  return `webui-import ${mode} videos=${report.videos} creators=${report.creators} images=${report.images} missing=${report.missingImages}${batch}`;
}

async function storeLocalImage(
  sql: Sql,
  assetsRoot: string,
  absolute: string,
  kind: 'cover' | 'face',
  batchId: string,
): Promise<string | null> {
  const bytes = new Uint8Array(readFileSync(absolute));
  let sniffed: { mime: ImageMime; width: number | null; height: number | null };
  try {
    sniffed = sniffImage(bytes);
  } catch {
    return null;
  }
  const stored = await storeImageBytes(sql, {
    assetsRoot,
    bytes,
    mime: sniffed.mime,
    width: sniffed.width,
    height: sniffed.height,
    kind,
    origin: 'webui',
    sourceUrl: null,
    importBatchId: batchId,
    fetchedAt: null,
  });
  return stored.assetId;
}

export async function importWebuiDirectory(options: {
  root: string;
  dryRun?: boolean;
  sql?: Sql;
  assetsRoot?: string | null;
  logger?: StudioLogger | null;
}): Promise<WebuiImportReport> {
  const videos = parseVideos(options.root);
  const creators = parseCreators(options.root);
  const images = countImages(options.root, videos, creators);
  const missingImages = videos.length + creators.length - images;
  if (options.dryRun) {
    return {
      dryRun: true,
      videos: videos.length,
      creators: creators.length,
      images,
      missingImages,
      batchId: null,
    };
  }
  if (!options.sql) throw new Error('import-webui 写库需要数据库连接');
  const assetsRoot = options.assetsRoot ?? null;
  if (!assetsRoot) throw new Error('MONITOR_ASSETS_ROOT 未设置，无法写入本地图片');
  const sql = options.sql;
  const batchId = crypto.randomUUID();
  const report: WebuiImportReport = {
    dryRun: false,
    videos: videos.length,
    creators: creators.length,
    images,
    missingImages,
    batchId,
  };
  options.logger?.info('开始导入 WebUI 元数据', {
    event: 'import.webui.started',
    context: { videos: videos.length, creators: creators.length, images },
  });
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO import_batches (id, mode, source_timezone, status, importer_version, report_json)
        VALUES (
          ${batchId}::uuid,
          'apply',
          'Asia/Shanghai',
          'running',
          ${WEBUI_IMPORTER_VERSION},
          ${tx.json(jsonValue(report))}
        )
      `;
      for (const video of videos) {
        const file = findImage(options.root, 'videos', `${video.bvid}_cover`);
        const assetId = file
          ? await storeLocalImage(tx as unknown as Sql, assetsRoot, file, 'cover', batchId)
          : null;
        const coverState = assetId ? 'ok' : 'failed';
        const metadata = { webui: { views: video.views ?? null } };
        await tx`
          INSERT INTO videos (
            bvid, title, category, metadata_source, metadata_state, cover_state, cover_asset_id, metadata
          ) VALUES (
            ${video.bvid},
            ${video.title},
            ${video.category},
            'webui',
            'partial',
            ${coverState},
            ${assetId},
            ${tx.json(jsonValue(metadata))}
          )
          ON CONFLICT (bvid) DO UPDATE SET
            title = CASE
              WHEN videos.metadata_source = 'bilibili' THEN videos.title
              ELSE COALESCE(EXCLUDED.title, videos.title)
            END,
            category = COALESCE(EXCLUDED.category, videos.category),
            cover_asset_id = CASE
              WHEN videos.metadata_source = 'bilibili' AND videos.cover_asset_id IS NOT NULL
                THEN videos.cover_asset_id
              ELSE COALESCE(EXCLUDED.cover_asset_id, videos.cover_asset_id)
            END,
            cover_state = CASE
              WHEN videos.metadata_source = 'bilibili' AND videos.cover_state = 'ok' THEN videos.cover_state
              WHEN EXCLUDED.cover_asset_id IS NOT NULL THEN 'ok'
              WHEN videos.cover_state = 'ok' THEN videos.cover_state
              ELSE EXCLUDED.cover_state
            END,
            metadata_source = CASE
              WHEN videos.metadata_source = 'bilibili' THEN videos.metadata_source
              ELSE 'webui'
            END,
            metadata_state = CASE
              WHEN videos.metadata_source = 'bilibili' THEN videos.metadata_state
              ELSE 'partial'
            END,
            metadata = videos.metadata || EXCLUDED.metadata,
            updated_at = now()
        `;
      }
      for (const creator of creators) {
        const file = findImage(options.root, 'creators', `${creator.mid}_avatar`);
        const assetId = file
          ? await storeLocalImage(tx as unknown as Sql, assetsRoot, file, 'face', batchId)
          : null;
        const metadata = {
          webui: { followers: creator.followers ?? null, lastUpdate: creator.lastUpdate ?? null },
        };
        await tx`
          INSERT INTO creators (
            mid, uname, face_url, category, face_asset_id, metadata_source, metadata_state, metadata
          ) VALUES (
            ${creator.mid}::bigint,
            ${creator.uname},
            NULL,
            ${creator.category},
            ${assetId},
            'webui',
            'partial',
            ${tx.json(jsonValue(metadata))}
          )
          ON CONFLICT (mid) DO UPDATE SET
            uname = CASE
              WHEN creators.metadata_source = 'bilibili' THEN creators.uname
              ELSE COALESCE(EXCLUDED.uname, creators.uname)
            END,
            category = COALESCE(EXCLUDED.category, creators.category),
            face_asset_id = CASE
              WHEN creators.metadata_source = 'bilibili' AND creators.face_asset_id IS NOT NULL
                THEN creators.face_asset_id
              ELSE COALESCE(EXCLUDED.face_asset_id, creators.face_asset_id)
            END,
            metadata_source = CASE
              WHEN creators.metadata_source = 'bilibili' THEN creators.metadata_source
              ELSE 'webui'
            END,
            metadata_state = CASE
              WHEN creators.metadata_source = 'bilibili' THEN creators.metadata_state
              ELSE 'partial'
            END,
            metadata = creators.metadata || EXCLUDED.metadata,
            updated_at = now()
        `;
      }
      await tx`
        UPDATE import_batches
        SET status = 'completed', completed_at = now(), report_json = ${tx.json(jsonValue(report))}
        WHERE id = ${batchId}::uuid
      `;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'webui import failed';
    options.logger?.error('WebUI 导入失败', {
      event: 'import.webui.failed',
      err: new Error(message),
      context: { batchId },
    });
    await options.logger?.flush();
    throw error;
  }
  options.logger?.info('WebUI 导入完成', {
    event: 'import.webui.finished',
    context: { batchId, videos: videos.length, creators: creators.length, images },
  });
  await options.logger?.flush();
  return report;
}
