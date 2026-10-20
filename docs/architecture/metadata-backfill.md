# 本地 WebUI 导入与元数据拉取

WP-R2-08。采集频率、熔断和样本表结构不变。这一层只补标题、封面、昵称、头像，以及接口上的 `cid` / `pubdate` / 简介 / 时长 / 标签 / 分区号。

测试和 CI 只注入传输层，不访问 B 站。真实拉取由维护者在本机执行。

## 导入映射

`import-webui --root <dir> [--dry-run]` 读 UTF-8（容忍 BOM）的 `videos.json` / `creators.json`，不读分类字典，分类取条目里的 `catagory` 原值。

| JSON                                           | 列                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `videos[].bvid`                                | `videos.bvid`                                                                                                                           |
| `videos[].title`                               | `videos.title`（已有 `metadata_source='bilibili'` 时保留接口标题）                                                                      |
| `videos[].catagory`                            | `videos.category`                                                                                                                       |
| —                                              | `videos.metadata_source='webui'`，`videos.metadata_state='partial'`                                                                     |
| `videos/<BV>_cover.(jpg\|jpeg\|png\|webp)`     | `static_assets`（`kind='cover'`，`origin='webui'`，`source_url` 为空）并回填 `videos.cover_asset_id`；文件缺失则 `cover_state='failed'` |
| `creators[].mid`                               | `creators.mid`                                                                                                                          |
| `creators[].name`                              | `creators.uname`                                                                                                                        |
| `creators[].catagory`                          | `creators.category`                                                                                                                     |
| —                                              | `creators.face_url` 留空；`metadata_source='webui'`，`metadata_state='partial'`                                                         |
| `creators/<mid>_avatar.(jpg\|jpeg\|png\|webp)` | `static_assets`（`kind='face'`，`origin='webui'`）并回填 `creators.face_asset_id`                                                       |

不写 `cid`、`pubdate`、`video_tags`。`videos.json` 的 `views` 和 `creators.json` 的 `followers` / `lastUpdate` 只留在 `metadata.webui`，不生成指标样本；历史曲线仍走 CSV 导入。

图片按内容 sha256 寻址：`bili/<kind>/<sha[0:2]>/<sha256>.<ext>`，`asset_id` 用已有的 `assetIdFromContentSha256`。同 sha 再次导入不新增 `static_assets` 行。`--dry-run` 只打印条数和图片数，不写库、不联网。成功导入写一行 `import_batches`（`mode='apply'`，`importer_version='webui-meta'`）和 `app_logs` 事件 `import.webui.started` / `import.webui.finished`。

## 拉取

| 入口                                                                           | 行为                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/monitor/videos/:bvid/refresh`                                    | 一次 `view/detail`。`force=false` 且 `metadata_state='ok'` 时直接返回现有数据                                                           |
| `POST /api/v1/monitor/creators/:mid/refresh`                                   | `relation/stat` 写一条粉丝样本；该 mid 已有视频时再取一条 `view/detail` 的 `Card` 补昵称和头像。没有 Card 时 `metadata_state='partial'` |
| `POST /api/v1/monitor/metadata/refresh`                                        | body `{ kind, ids?, allMissing?, force? }`，返回 `202 { backfillRunId, requested }`。同一时刻只有一个 `running` 批次，冲突返回 409      |
| `GET /api/v1/monitor/metadata/runs/:id` 与 `GET /api/v1/ops/metadata/runs/:id` | `status` / `requested` / `succeeded` / `failed` / `skipped` / `report`                                                                  |

视频成功后写入 `title`、`description`、`duration_seconds`、`cid`、`pubdate`、`tid`、`tid_v2`、`cover_url`，`video_tags` 先删后插并保留接口顺序，然后 `metadata_state='ok'`、`metadata_source='bilibili'`。`tname` / `tname_v2` 为空时 `partition_name` 保持空，不填「未知」。缺 `cid` 就留空。

`-352` / `-412` / `-509` 把整个批次标成 `aborted` 并停止后续条目。`-404` 只让该条 `metadata_state='failed'`。错误经 `scrubString` 截断到 500 字。`running` 且 10 分钟没有心跳的批次在下次领取或查询时标成 `aborted`。

CLI：

```bash
bun run apps/collector/src/cli.ts import-webui --root <webui_meta> [--dry-run]
bun run apps/collector/src/cli.ts fetch metadata --kind video --bvid <BV> [--execute]
bun run apps/collector/src/cli.ts fetch metadata --kind creator --mid <mid> --dir <webui_meta> --all-missing [--limit N] [--force] [--execute]
```

`fetch metadata` 默认是 dry-run（只打印将处理的条数）。加上 `--execute` 才发请求。

## 共享配额

`collector_rate_state(account_id, window_started_at, count, last_request_at)` 加 `acquireRequestSlot`。事务里先拿 `pg_advisory_xact_lock(hashtext('bili-rate:' || account_id))`，把下一次放行时间写进行，**提交之后锁才释放**，然后才睡眠到那个时间。因此同一次采集里的 `view` 和 `online`、以及 `view/detail` 和随后的图片下载，都会相隔至少 `COLLECTOR_MIN_INTERVAL_MS` 加抖动。环境变量仍是 `COLLECTOR_MIN_INTERVAL_MS`、`COLLECTOR_MAX_JITTER_MS`、`COLLECTOR_MAX_REQUESTS_PER_MINUTE`；没有 Cookie 时最小间隔仍至少 5 秒。没有账号 UUID 的流量共用 `00000000-0000-0000-0000-000000000000`。

有数据库连接时（采集进程、API/CLI 刷新）只走 `acquireRequestSlot`。没有 `sql` 时（不连库的单元测试）走进程内的 `createAccountThrottle`，规则相同，但不能跨进程共享。两条路径不会叠在同一次请求上。

封面和头像下载只允许 HTTPS 的 `*.hdslb.com`（重定向后再次校验），校验魔数，拒绝 GIF，超过 8 MiB 或 10 秒即失败，请求不带 Cookie。

## 审计

每一次 `view/detail`、`relation/stat`、创作者补资料用的 `card`（仍是一次 `view/detail`）、以及真正发出的图片下载，都写一行 `collector_requests`。`run_id` 在批量刷新时填 `backfill_runs.id`（该列不再外键到 `collector_runs`，采集任务仍按原来的方式写入自己的 run id）。没有登录账号时 `account_id` 留空。错误文本先过 `scrubString`。

API 把进程 logger 传给刷新。批次写 `backfill.started` / `backfill.finished`；单条失败写 `backfill.item_failed`（warn，带 bvid 或 mid 和业务码）。
