# 日志与运维诊断

WP-R2-07。采集频率、熔断和样本写入不变。这一层只把已经落库的运行记录、心跳和请求审计变成可查的诊断面，并补上视频/创作者元数据列。没有真实网络请求，也不下载封面。

## app_logs 写入策略

stdout 始终是一行 JSON，字段固定为 `level`、`time`、`service`、`instance`、`env`、`msg`、`event`、`requestId`、`jobId`、`runId`、`targetId`、`context`。出现错误时附加 `err`：`{type, message, stack, code}`。

入库只走 `packages/observability` 的 PostgreSQL sink，业务代码不等待它。失败时再写一行 stdout（`log.sink_failed`），不抛回调用方。

| 级别                                          | 是否入库                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `warn`、`error`                               | 全部                                                                                                                                                                                       |
| `info`                                        | 仅生命周期事件：`job.claimed`、`job.succeeded`、`job.failed`、`circuit.open`、`circuit.close`、`backfill.started`、`backfill.finished`、`auth.login`、`service.started`、`service.stopped` |
| `debug`，以及其他 `info`（含 `http.request`） | 只留在 stdout                                                                                                                                                                              |

`http.error` 是 `error`，因此入库。脱敏在写入口完成：Pino `redact` 覆盖 `req.headers.cookie`、`req.headers.authorization`、`*.SESSDATA`、`*.bili_jct`、`*.password`、`*.secret`、`*.ciphertext`；序列化后再替换 `SESSDATA=[^;]+`、`bili_jct=[^;]+`、`Bearer [A-Za-z0-9._-]+`，并去掉这些词本身。读 `/api/v1/ops` 时再洗一次，避免历史行把明文带回页面。

`app_logs` 保留 14 天。API 和 Collector 进程启动时删一次，之后每 6 小时再删。天数由 `APP_LOG_RETENTION_DAYS` 覆盖。Docker Compose 的 `app` 和 `collector` 使用 `max-size: 20m`、`max-file: 5`。

## 只读接口

全部挂在 `/api/v1/ops`，没有写方法。列表用 `limit`（默认 50，最大 200）和下降游标 `cursor`。

| 方法 | 路径                              | 响应                                                                                                                          |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/v1/ops/summary`             | `{ heartbeats, queue: { due, running, failed24h }, circuits, targets, samplesToday: { videos, creators }, recentErrorCount }` |
| GET  | `/api/v1/ops/runs`                | `{ items: OpsRun[], nextCursor, limit }`，可按 `status`、`targetId`、`since`、`until` 过滤                                    |
| GET  | `/api/v1/ops/runs/:id`            | `{ run, requests, logs }`，日志最多 200 行；不存在时 404                                                                      |
| GET  | `/api/v1/ops/requests`            | `{ items: OpsRequest[], nextCursor, limit }`，可按 `endpoint`、`since` 过滤                                                   |
| GET  | `/api/v1/ops/logs`                | `{ items: OpsLog[], nextCursor, limit }`，可按 `level`、`service`、`runId`、`requestId`、`q`、`since` 过滤                    |
| GET  | `/api/v1/ops/health`              | `{ lastHeartbeatAt, stale, queueBacklog, lastSuccessAt }`。超过 30 秒没有心跳则 `stale`                                       |
| GET  | `/api/v1/ops/debug/bundle?runId=` | `{ schemaVersion, generatedAt, run, target, requests, logs, video, creator, heartbeats, circuits }`                           |

`OpsRun` 是 `id`、`targetId`、`targetLabel`、`status`、`samplesWritten`、`durationMs`、`error`、`startedAt`、`finishedAt`。`OpsRequest` 是 `id`、`endpoint`、`statusCode`、`bizCode`、`durationMs`、`error`、`requestedAt`、`runId`。`OpsLog` 是 `id`、`ts`、`level`、`service`、`event`、`message`、`requestId`、`runId`、`context`。

页面在 `/ops`，从侧栏「设置」进入。状态卡、运行列表、运行抽屉和日志检索都是只读的。日志自动刷新间隔 10 秒，默认关闭。

封面文件仍由 `GET /api/v1/assets/:assetId` 提供。命中磁盘文件时带 `Cache-Control: public, max-age=31536000, immutable`、`ETag` 和 `Content-Length`；`If-None-Match` 命中返回 304。缺失时仍是占位 SVG。本包不下载、不写入图片字节。回填执行留给 WP-R2-08；`backfill_runs` 只建表。
