# 日志与运维诊断

WP-R2-07。采集频率、熔断和样本写入不变。这一层只把已经落库的运行记录、心跳和请求审计变成可查的诊断面，并补上视频/创作者元数据列。没有真实网络请求，也不下载封面。

## app_logs 写入策略

stdout 始终是一行 JSON，字段固定为 `level`、`time`、`service`、`instance`、`env`、`msg`、`event`、`requestId`、`jobId`、`runId`、`targetId`、`context`。出现错误时附加 `err`：`{type, message, stack, code}`。

入库只走 `packages/observability` 的 PostgreSQL sink，业务代码不等待它。失败时再写一行 stdout（`log.sink_failed`），不抛回调用方。

| 级别                                          | 是否入库                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `warn`、`error`                               | 全部                                                                                                                                                                                                                                                                                                                                                                                 |
| `info`                                        | 仅生命周期事件：`job.claimed`、`job.succeeded`、`job.failed`、`circuit.open`、`circuit.close`、`backfill.started`、`backfill.finished`、`backfill.aborted`、`import.webui.started`、`import.webui.finished`、`auth.login`、`service.started`、`service.stopped`、`legacy.sync.started`、`legacy.sync.finished`、`legacy.sync.failed`。`backfill.item_failed` 是 `warn`，因此也会入库 |
| `debug`，以及其他 `info`（含 `http.request`） | 只留在 stdout                                                                                                                                                                                                                                                                                                                                                                        |

`http.error` 是 `error`，因此入库。脱敏在写入口完成：Pino `redact` 覆盖 `req.headers.cookie`、`req.headers.authorization`、`*.SESSDATA`、`*.bili_jct`、`*.password`、`*.secret`、`*.ciphertext`；序列化后再替换 `SESSDATA=[^;]+`、`bili_jct=[^;]+`、`Bearer [A-Za-z0-9._-]+`，并去掉这些词本身。读 `/api/v1/ops` 时再洗一次，避免历史行把明文带回页面。

`app_logs` 保留 14 天。API 和 Collector 进程启动时删一次，之后每 6 小时再删。天数由 `APP_LOG_RETENTION_DAYS` 覆盖。Docker Compose 的 `app` 和 `collector` 使用 `max-size: 20m`、`max-file: 5`。

等待入库的记录、已经拆出但还没开始写的批次，以及当前正在写的批次共用一个上限。默认 1000 条，序列化后默认 4MiB。`LOG_QUEUE_MAX_RECORDS` 和 `LOG_QUEUE_MAX_BYTES` 只接受范围内的正整数，空值沿用默认；非法值在进程启动时失败，不会变成不设上限。队列满时保留已有记录并拒绝新记录。stdout 最多每秒汇总一次 `log.queue_overflow`，内容只有计数。API 与 Collector 共用这一容量。Compose 把这两个变量传给 `app` 和 `collector`。

Collector 收到 SIGTERM 或 SIGINT 后停止领取新任务，等当前任务在预算内结束，写入 `service.stopped`，再限时 flush，停止 retention，关闭数据库。队列已满时先冲掉已有批次，再尝试把这次停止事件放进腾出的名额；名额仍不够、当前任务超时、尾批没有持久化，或采集主循环自己失败时，退出码不是 0。主循环失败会把脱敏后的原因写到 stdout（`process.loop_failed`），后面的 flush 不会把退出码改回 0。flush 默认 10 秒（`LOG_FLUSH_DEADLINE_MS`），整个退出默认 20 秒（`PROCESS_EXIT_BUDGET_MS`）。`collector` 与 `app` 的 `stop_grace_period` 都是 30 秒。重复信号不会再写一次停止事件。

API 进程使用同一套有期限的关闭序列，但工作边界在 API 入口：退出开始后新的 HTTP 返回 503，已经接受的请求以及这些请求在信号前或信号后登记的进程内后台 Promise 都要进入本次收尾。业务 handler 返回响应对象之后，还要等 Bun 把这次响应发送完。客户端读得慢、但能在退出预算内读完时，退出码是 0。预算内发不完则退出码不是 0，并写明响应未发送完成，然后关闭监听。后台拒绝、超时，或停止事件没有持久化时，退出码也不是 0，诊断里的秘密会脱敏。更早已经独立结束的失败不会让以后的健康退出一直失败。API 不等待独立 Worker 把库里的采集任务清空。

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
