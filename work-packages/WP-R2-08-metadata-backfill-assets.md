# WP-R2-08 本地 WebUI 数据导入与元数据拉取接口

> 基线：WP-R2-07 的分支（迁移 007、`app_logs`、`/ops`、`backfill_runs` 已就绪）。
> 本包分两部分：**A 本地导入（零网络）**、**B 可复用的单条/批量拉取接口（会发真实请求，但执行由 Hermes 控制）**。

## 1. 实测到的事实（2026-10-19，勿再猜）

旧前端 `D:\App\video-data-gui\public\data\` 里有完整静态元数据，已复制到 NAS：

```
/mnt/neoserver/data/_hermes_inbox/webui_meta/
  videos.json          # 46 条: bvid, title, cover, views, catagory
  creators.json        # 57 条: mid, name, avatar, followers, lastUpdate, catagory
  catagory.json        # 分类字典: 狐正正/抽奖观测/事件观测；创作者: 长期观测/...
  videos/              # 46 张封面 <BV>_cover.jpg + 46 个 <BV>_views.csv
  creators/            # 57 张头像 <mid>_avatar.jpg + 56 个 <mid>_follower.csv
```

完整性已核对：封面 46/46、头像 57/57、播放 CSV 46/46、粉丝 CSV 56/57（缺 mid `3493128264747100`）。
所以**标题、封面、昵称、头像、分类、粉丝初值全部可以离线导入**；接口只需要补 `tags / cid / pubdate / desc / duration / owner 关联`。

单次 `GET /x/web-interface/view/detail?bvid=` 实测返回：`View.{bvid,aid,cid,title,pubdate,duration,tname,tname_v2,tid,tid_v2,desc,pic,owner{mid,name,face},stat{...}}`、`Tags[]`、`Card{card{name,face,sign},follower,archive_count}`；`tname` 与 `tname_v2` 都是空字符串（平台改造中），`tid=95`、`tid_v2=2102` 有值。

## 2. A. 本地导入（`import-webui`）

CLI：`bun run apps/collector/src/cli.ts import-webui --root <webui_meta> [--dry-run]`

规则：

- 读 `videos.json` / `creators.json`（UTF-8 BOM 容忍），按条目 upsert：
  - `videos`：`bvid`、`title`、`category`（取 `catagory` 原值）、`metadata_source='webui'`、`metadata_state='partial'`（还缺 tags/cid/pubdate）、`cover_state` 由图片导入结果决定；
  - `creators`：`mid`、`uname`、`face_url` 留空（本地图片直接进资产）、`category`、`metadata_source='webui'`、`metadata_state='partial'`；
- 图片：读 `<root>/videos/<BV>_cover.jpg`、`<root>/creators/<mid>_avatar.jpg`，复用 `assetIdFromContentSha256` 的内容寻址写入（sha256 命名、原子 rename、`static_assets` 记录 `kind/source_url=NULL/origin='webui'/byte_size/width/height`），回填 `videos.cover_asset_id` / `creators.face_asset_id`；
- **不伪造**：没有标签就不写标签，没有 cid 就不写 cid，`pubdate` 留空；`metadata_state` 必须是 `partial` 而不是 `ok`；
- 幂等：重复执行不重复插资产（同 sha 命中）、不覆盖已经有 API 来源（`metadata_source='bilibili'`）的标题；
- `--dry-run` 只打印将处理的条目数与图片数，零写库零网络；
- 结果写入 `import_batches`（复用现有表）与 `app_logs`（`import.webui.*`）。`origin` 的 CHECK 需要把 `webui` 加进 `static_assets.origin` 与 `metadata_source` 的允许值（迁移 007 已含 `manual/legacy_csv/bilibili`，本包补 `webui`）。

## 3. B. 可复用的拉取接口（不是一次性脚本）

### 3.1 单条与批量

- `POST /api/v1/monitor/videos/:bvid/refresh` → 同步拉取该视频（1 次 `view/detail`），返回 `{ bvid, cid, title, tags, metadataState, coverState }`；已是最新且 `force=false` 时直接返回现有数据，不发请求。
- `POST /api/v1/monitor/creators/:mid/refresh` → `relation/stat`（+ 有视频时用 `Card` 补昵称头像）。
- `POST /api/v1/monitor/metadata/refresh` → 批量：body `{ kind: 'video'|'creator', ids?: string[], allMissing?: boolean, force?: boolean }`；
  返回 `202 { backfillRunId, requested }`，进度写 `backfill_runs`，**串行执行**（同一时刻只允许一个批次）。
- 查询进度：`GET /api/v1/monitor/metadata/runs/:id`（也可走 `/ops`），返回 `status/requested/succeeded/failed/skipped/report`。
- CLI 等价：`fetch metadata --kind video --bvid X | --dir <webui_meta> | --all-missing [--limit N] [--force] [--dry-run]`。

### 3.2 共享限流（关键）

采集容器和 API/CLI 都会发请求，各自 `setTimeout` 限流会叠加。必须在数据库层做**跨进程共享配额**：

- 新表 `collector_rate_state(account_id uuid PK, window_started_at timestamptz, count int, last_request_at timestamptz)`；
- `packages/monitoring/src/rate-limiter.ts` 暴露 `acquireRequestSlot(sql, accountId, policy)`：用 `pg_advisory_lock(hashtext('bili-rate:'||account_id))` 串行，读状态表判断最小间隔与每分钟上限，必要时 sleep 后再放行，最后更新状态；
- 采集器的既有节流改为调用同一函数（保留原环境变量语义），回填/刷新也必须走它；
- 结果：无论多少进程，同一账号都不会超过「最小间隔 + 每分钟上限」。

### 3.3 执行与失败

- 每条视频：`view/detail` → 写 `title/desc/duration/cid/pubdate/tid/tid_v2/cover_url` + `video_tags`（先删后插，ordinal 保留接口顺序）+ 封面下载 → `metadata_state='ok'`、`metadata_source='bilibili'`、`metadata_fetched_at=now()`。
- 每条 UP 主：`relation/stat` 写粉丝样本；`Card` 可用则补 `uname/face`；否则 `metadata_state='partial'`。
- 单条失败不中断，写 `metadata_error`（≤500 字，经 `scrubString`）；遇 `-352/-412/-509` **整批中止**（`status='aborted'`），避免打死账号。
- 批量批次有心跳/超时：进程重启后，`running` 且 10 分钟无进展的批次标记为 `aborted`，可重跑（幂等）。
- 所有请求仍受用户授权范围约束：默认 `--dry-run`，真实执行只由维护者触发。

## 4. 图片存储（沿用 WP-R2-07 规格）

- 路径 `${ASSETS_ROOT}/bili/<kind>/<sha[0:2]>/<sha256>.<ext>`，内容寻址、原子写入、sha 去重；
- 来源：本地导入（`origin='webui'`）与接口下载（`origin='bilibili'`）共用同一写入函数；
- 接口下载限制：仅 https、域名 `*.hdslb.com`（重定向后校验）、魔数校验、≤8 MiB、10 s 超时、**不带 Cookie**；
- 读接口 `/api/v1/assets/:id` 保持 `immutable` 缓存 + ETag + Content-Length；缺失返回占位图。

## 5. 测试（离线）

- 本地导入：用 3 个视频 + 2 个 UP 主的固定目录（含 BOM JSON、1×1 PNG、缺失封面各一例）断言：标题进库、`metadata_state='partial'`、资产去重、缺失封面 `cover_state='failed'`、重复导入零新增。
- 拉取：伪造 transport 返回固化 `view/detail`（含 Tags、空 tname、tid/tid_v2）断言 cid/tags/pubdate/desc/duration/tid 写入、`metadata_state='ok'`、重复执行不新增标签。
- 失败路径：`-352` 整批 aborted；`-404` 单条 failed；超 8 MiB / 非 hdslb / http / `image/gif` 四种拒绝。
- 限流：两个并发调用（模拟两个进程）在同一账号上不会突破每分钟上限（用假时钟或注入 sleep）。
- API：`/metadata/refresh` 返回 202 且只有一条 running；`/refresh` 在 `force=false` 且已 ok 时零请求。
- 全部门槛命令通过。

## 6. 不做

- 不做评论列表、WBI 签名接口、采集频率调整。
- 不删除历史样本、不改 CSV 导入语义。
- 不在 CI/测试里访问网络；真实执行由维护者在批准后运行。
