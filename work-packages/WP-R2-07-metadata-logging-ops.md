# WP-R2-07 元数据模型、资产存储与日志/诊断体系

> 基线：`cursor/real-collector-worker-6429` @ `c0c76a343428aa4247f87297e48141bdd2d77dd5`（PR #28，已验收，勿改写其行为）。
> 本包只做「准备工程」：数据库补齐、图片落地、日志与诊断可查。**不做真实网络请求**，不含回填执行（见 WP-R2-08）。

## 1. 背景（必须理解，否则会做错）

旧系统只保存了 CSV：`<BV>_views.csv`、`<mid>_follower.csv`。导入后 `videos` 只有 `bvid`，**没有标题、没有封面、没有标签、没有 cid/pubdate**；`creators` 只有 `mid`，没有昵称和头像。业务侧（商单复盘、对标、账号运营）需要按标题/标签/封面认视频，光有 BV 号等于不可用。

同时，用户明确指出：**日志系统没有提前设计好，以后排查会很痛**。已定的方案（见 `新增需求分期与WP-003启动评估`）是「Pino 结构化日志 + PostgreSQL 业务审计 + Collector runs/心跳」，**但代码里一行都没实现**：现在只有 `console.log` 和几张运行记录表，没有级别、没有 requestId、没有 API 可查、没有调试包。

本包把这三件事一次性补成可用状态。

## 2. 数据库迁移 007（`packages/db/migrations/007_metadata_assets_logs.sql`）

风格与 006 保持一致：幂等（`IF NOT EXISTS` / `DO $$` 守卫）、时间一律 `timestamptz`、约束写成 `CHECK` 常量。

### 2.1 `videos` 增列

| 列                    | 类型                              | 说明                                                                |
| --------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `description`         | text                              | 简介（`View.desc`）                                                 |
| `duration_seconds`    | integer                           | 时长（`View.duration`，秒）                                         |
| `cover_url`           | text                              | 原始封面 URL（https 化后保存），作为本地资产缺失时的兜底            |
| `cover_state`         | text NOT NULL DEFAULT `'pending'` | `pending`/`ok`/`failed`/`none`，CHECK 约束                          |
| `metadata_state`      | text NOT NULL DEFAULT `'pending'` | `pending`/`ok`/`failed`/`partial`，CHECK 约束                       |
| `metadata_source`     | text                              | `bilibili`/`legacy_csv`/`manual`                                    |
| `metadata_fetched_at` | timestamptz                       | 最近一次成功拉取时间                                                |
| `metadata_error`      | text                              | 最近一次失败原因（截断 500 字符，禁止写入 Cookie/URL 里的敏感参数） |

索引：`(metadata_state) WHERE metadata_state <> 'ok'`（回填队列扫描）、`(cover_state) WHERE cover_state <> 'ok'`。

### 2.2 `creators` 增列

`face_url text`、`metadata_state`、`metadata_source`、`metadata_fetched_at`、`metadata_error`，语义同上。

### 2.3 新表 `video_tags`

```sql
CREATE TABLE IF NOT EXISTS video_tags (
  bvid text NOT NULL REFERENCES videos(bvid) ON DELETE CASCADE,
  tag text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'bilibili',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bvid, tag)
);
CREATE INDEX IF NOT EXISTS video_tags_tag_idx ON video_tags (tag);
```

为什么用表而不是 `text[]`：业务要回答「这个标签下我还有哪些视频」「同类标签的播放中位数」，需要反向 join；表还能记录顺序与来源。

### 2.4 `static_assets` 增列

`kind text NOT NULL DEFAULT 'import'`（`cover`/`face`/`import`/`other`，CHECK）、`source_url text`、`byte_size integer`、`width integer`、`height integer`、`fetched_at timestamptz`、`origin text NOT NULL DEFAULT 'import'`（`bilibili`/`import`/`manual`）。

`asset_id` 继续用「内容 sha256 派生」的规则（现有 `assetIdFromContentSha256`），相同图片只存一份。

### 2.5 新表 `app_logs`

```sql
CREATE TABLE IF NOT EXISTS app_logs (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL,              -- debug/info/warn/error
  service text NOT NULL,            -- api/collector
  instance text,
  event text,                       -- 机器可读事件名，如 job.failed
  message text NOT NULL,
  request_id text,
  job_id uuid,
  run_id uuid,
  target_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX app_logs_ts_idx ON app_logs (ts DESC);
CREATE INDEX app_logs_level_ts_idx ON app_logs (level, ts DESC);
CREATE INDEX app_logs_run_idx ON app_logs (run_id, ts) WHERE run_id IS NOT NULL;
CREATE INDEX app_logs_request_idx ON app_logs (request_id) WHERE request_id IS NOT NULL;
```

写入策略：`level >= warn` 全量入库；`info` 只入关键生命周期事件（任务开始/成功/失败、熔断开关、回填批次、登录、启动/停止）。**绝不写入 Cookie、SESSDATA、Authorization、数据库密码、完整请求头**——脱敏在写入口完成，不依赖调用方。

### 2.6 新表 `backfill_runs`

```sql
CREATE TABLE IF NOT EXISTS backfill_runs (
  id uuid PRIMARY KEY,
  kind text NOT NULL,               -- video/creator
  mode text NOT NULL,               -- bvid/dir/all-missing
  status text NOT NULL,             -- running/succeeded/failed/aborted
  requested integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
```

## 3. 日志（Pino）

- 依赖只用 `pino`（+ 现有依赖），不引入 Loki/Grafana/OpenObserve。
- 新包 `packages/observability`：`createLogger({service, instance})`，字段固定为 `level/time/service/instance/env/msg/event/requestId/jobId/runId/targetId/context`；`err` 序列化为 `{type,message,stack,code}`。
- 脱敏：`redact` 覆盖 `req.headers.cookie`、`req.headers.authorization`、`*.SESSDATA`、`*.bili_jct`、`*.password`、`*.secret`、`*.ciphertext`；再叠加一层字符串级兜底（正则替换 `SESSDATA=[^;]+`、`bili_jct=[^;]+`、`Bearer [A-Za-z0-9._-]+`）。
- 输出：stdout 单行 JSON（Docker 侧负责轮转，compose 增加 `logging: max-size: 20m, max-file: '5'`）；同时挂一个 PG sink，把 `>=warn` 与白名单事件写入 `app_logs`（批量、失败只降级为 stdout，不能阻塞业务）。
- API 中间件：读取/生成 `x-request-id`，回写响应头；为每个请求建 child logger，记录 `http.request`（method/path/status/durationMs）；错误统一 `http.error` 并带 `requestId`。
- Collector：每个任务建 child logger（`jobId/runId/targetId`），关键节点打 `job.claimed/job.succeeded/job.failed/circuit.open/circuit.close`。
- 日志保留：启动时与每 6 小时清理 `app_logs` 中 14 天前的行（参数化）。

## 4. 只读诊断 API（`/api/v1/ops`）

全部只读，禁止写操作。分页统一 `limit`（默认 50，最大 200）+ `cursor`（`id` 或 `ts` 下降游标）。

| 端点                           | 返回                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ops/summary`             | collector 心跳（instance/status/lastSeenAt/currentJobId）、队列（due/running/failed 24h）、熔断（活跃 circuit 列表）、每个目标最后一次成功与错误、样本今日增量、`app_logs` 最近 1 小时 error 计数 |
| `GET /ops/runs`                | 运行列表：`id/targetId/targetLabel/status/samplesWritten/durationMs/error/startedAt/finishedAt`，支持 `status/targetId/since/until`                                                               |
| `GET /ops/runs/:id`            | 单次运行详情：run + 该 run 的 `collector_requests` 逐条（endpoint/status/bizCode/duration/error）+ 该 `run_id` 的日志尾部（最多 200 行）                                                          |
| `GET /ops/requests`            | 请求审计：`endpoint/statusCode/bizCode/durationMs/error/requestedAt/runId`，支持 `endpoint/since`                                                                                                 |
| `GET /ops/logs`                | 日志：`ts/level/service/event/message/requestId/runId/context`，支持 `level/service/runId/requestId/q/since/limit`                                                                                |
| `GET /ops/debug/bundle?runId=` | 一次性返回排障包（JSON）：run、target、该 run 的 requests、日志切片、相关 video/creator 行、collector 心跳、schema 版本、最近的 circuit；所有敏感字段已脱敏。这是「我要排查」时的唯一入口         |
| `GET /ops/health`              | 采集端存活：最近心跳时间、`stale` 布尔、队列积压数、最近一次成功时间                                                                                                                              |

实现放在 `apps/api/src/ops-routes.ts`，注册到 `app.ts`；类型定义进 `packages/contracts`；必须补 API 合同测试。

## 5. 前端诊断页（只读）

新增 `/ops` 页面（导航放「设置/运维」下，不占主业务导航）：

- 顶部状态卡：采集端心跳（绿/黄/红）、队列积压、24 小时失败数、活跃熔断数。
- 运行列表：时间、目标、状态、耗时、写入条数、错误摘要；支持按状态/目标/时间过滤。
- 点开运行 → 抽屉：请求明细表（端点/耗时/bizCode）、日志尾部、`复制排障包` 按钮（下载 `/ops/debug/bundle` 的 JSON）。
- 日志检索：级别/服务/关键字/runId 过滤，最多 200 行，自动刷新开关（10 秒）。
- 窄屏 390px 不横向溢出；空态、错误态、加载态齐全；不展示任何 Cookie/密钥。

## 6. 测试与验收（必须）

- 迁移：连续执行两次无报错；`video_tags` 主键去重；`app_logs` 索引存在；`cover_state`/`metadata_state` 非法值被拒。
- 日志：给定包含 `SESSDATA=xxx; bili_jct=yyy` 的错误字符串，写库与 stdout 均不含明文；`requestId` 在响应头与日志中一致。
- API：`/ops/*` 在空库与有数据两种情况都返回 200 且结构稳定；`debug/bundle` 不含敏感字段（用断言扫 `SESSDATA|bili_jct|password|ciphertext`）。
- 前端：`bun test` 覆盖 `/ops` 页面的空态/加载/错误/正常四态；390 与 1440 无横向溢出（可用现有测试工具）。
- 全部门槛：`bun run lint && bun run typecheck && bun test && bun run build && bun run format:check` 通过。
- 不新增任何真实网络请求；测试不得依赖外网。

## 7. 不做

- 不做回填执行、不下载图片（WP-R2-08）。
- 不改 006 的采集语义（频率、熔断、样本写入）。
- 不做权限系统、不做日志导出到外部平台、不做告警推送。
