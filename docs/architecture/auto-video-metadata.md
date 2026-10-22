# 新视频首次采集后自动补全封面与元数据

WP-R2-MON-03。复用 WP-R2-08 的 `startMetadataBackfill` / `refreshVideo`、`static_assets`、全局请求节流与 `collector_requests` 审计，不新建并行管道。

## 触发

仅 **video** 目标，在 **首次指标采集成功**（提交前 `last_success_at IS NULL`）且 `videos.cover_asset_id IS NULL` 时，于提交后辅助路径入队一条既有 metadata refresh（`backfill_runs`，`report.auto=true`，`report.requestedIds` 含该 bvid）。

- 不在创建监控目标的 HTTP 请求里同步打上游。
- UP / dynamic 不入队。
- 历史 CSV / 本地导入只写样本或 `pending` 行时**不会**打上队列标记，也不会被 drain 扫到。

## 幂等

| 条件 | 行为 |
| --- | --- |
| 已有 `cover_asset_id` | 跳过入队；刷新执行时也不再下载图片 |
| 同 bvid 已有 `running` 且 `report.requestedIds` 含该 bvid | 跳过 |
| 全局已有其它 `running` 批次 | 写入 `videos.metadata.auto_metadata_refresh='queued'`，采集轮询时 `drainDeferredAutoVideoMetadataRefresh` 再试 |
| 同 bvid 并发两次入队 | 至多一条活跃 `running` 刷新项 |

## 隔离

入队与刷新挂在 `runPostCommitHelpers` / 后台 `done` 上：补全失败只更新该视频的 `cover_state` / `metadata_state`（及可读错误），**不**把采集 job 标失败、**不**停用目标、**不**回滚已写入的指标样本。节流仍走 `acquireRequestSlot`（全局 API ≥ 配置间隔），单次只处理该 bvid。

## 接线

- `packages/monitoring/src/auto-video-metadata.ts`：入队 / drain
- `bilibili-job`：首次 video 成功后调用 hook
- `collector-runner`：每次 `runCollectorOnce` 先 drain 至多 1 条推迟项
- `apps/collector`：`COLLECTOR_PROVIDER=bilibili` 且设置了 `MONITOR_ASSETS_ROOT` 时启用

## 验收要点

注入 transport：view/online → view/detail → 图片下载（类型 / 大小 / 魔数）→ `static_assets` → `cover_url` / `cover_asset_id` / `cover_state` / `metadata_state`；详情与卡片 API 返回非空图片字段。补全前详情/卡片仍为 200（字段为空）。图片失败时可再次入队；已有 cover 时不重复下载。
