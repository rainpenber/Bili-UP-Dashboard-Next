# WP-R2-06 真实数据采集 Worker（B 站视频 / UP 主 → PostgreSQL）

> 状态：待开发（Cursor Cloud Agent）
> 前置：WP-R2-05（离线采集器、目标管理、独立 collector 进程）已合并到基线分支
> 本包只做**后端采集与入库**；不做前端 UI、不做二维码登录页面（表结构先留好）、不接商单发布逻辑

## 0. 一句话目标

把现在只会读离线夹具的 collector，换成**能 7×24 持续运行、真实请求 B 站、把视频与 UP 主指标幂等写进 PostgreSQL 的独立 worker**。前端怎么改、API 怎么改，都不影响采集进程继续跑；采集进程也不需要任何前端代码。

## 1. 业务背景（先读，后面所有设计都从这儿来）

我们是三人的自媒体工作室，主业是接甲方商单、按 Brief 做视频、发布到 B 站（主号 + 老号）。

数据监控服务三类人、三种用途：

1. **我自己（进度与经营）**：每个已发布商单视频上线后的播放/互动走势，用来判断这条片子是否达到甲方预期、是否需要投流补量、以及给甲方做数据汇报。
2. **选题与对标**：对标账号、同类视频的走势，用来看什么题材起量、什么时间点爆发。
3. **账号运营**：自家账号与对标账号的粉丝增减，判断内容方向是否正确。

所以系统真正关心的实体只有四个：**视频（BV）**、**UP 主（mid）**、**采集目标（我要长期盯谁）**、**采集账号（用谁的凭据去查）**，加上时间序列样本和采集过程记录。

旧系统是 Python 脚本 + CSV（`D:\App\scripts\v2`），已经稳定跑了 1 年多，是这次实现最重要的行为锚点：它的字段、频率、错误处理方式都经过了真实风控环境的检验。但它有明显缺陷：

- 只落 CSV，没有数据库，无法多端查询、无法关联商单项目；
- 视频统计重复请求了两次 `/x/web-interface/view`（一次拿 cid、一次拿 stat）；
- **漏采评论数**（`stat.reply`），这是本包必须补上的字段；
- Cookie 明文放 `cookie.txt`，单账号，无法切换；
- 没有请求审计、没有熔断，出问题只能翻日志。

新实现要保留它"稳"的部分（保守频率、单账号串行、失败不硬重试），修掉它"散"的部分。

## 2. 架构硬约束（这是本包存在的前提）

```
apps/web  ──HTTP──▶  apps/api  ──SQL──▶  PostgreSQL  ◀──SQL──  apps/collector
                                              ▲
                                    packages/db（迁移与查询）
```

- **collector 不得 import `apps/web` 或 `apps/api` 的任何代码**；只允许依赖 `packages/db`、`packages/contracts`（只读类型）和 `packages/monitoring`。
- **数据库是唯一契约**。目标、任务、样本都通过表传递；不要为了"方便"让 worker 回调 API。
- **迁移只由 `apps/api` 启动时执行**（现状）。collector 启动时如果表还没建好，要有界重试等待，绝不能自己跑迁移。
- collector 必须能在**没有任何前端、没有 API 进程**的情况下单独启动、持续采集。
- 新增依赖必须能离线跑测试；CI 不得发出真实网络请求。

## 3. 概念模型

```
bili_accounts（采集账号/凭据）
      │ 1
      │ N（可为空 = 用默认账号）
monitor_targets（采集目标：一个 BV 或一个 mid）
      │ 1
      │ N
collector_jobs（某目标某时刻的一次采集任务）──1:N──▶ collector_runs（一次执行）
                                                            │
                                            ┌───────────────┴───────────────┐
                                            ▼                               ▼
                              video_metric_samples                 creator_follower_samples
                                  （BV + 时刻）                        （mid + 时刻）

videos（BV 实体，含 cid/mid/标题/发布时间）◀──N:1── creators（UP 主实体）
      ▲
      │ linked_bvid
project_monitor_contracts（商单项目 ↔ 已发布视频）──▶ 商单看板复用同一批样本
```

关键取舍（**不要改**，改了以后数据库一定会返工）：

1. **目标与实体分离**。`monitor_targets` 是"我要盯谁"的意图，可以暂停、软删；`videos`/`creators` 是平台事实，永不因为目标删除而删除——商单项目还在引用它们的历史数据。
2. **账号与目标分离**。默认账号全局一份，`monitor_targets.account_id` 可空，覆盖默认。未来"个人数据必须用指定账号"也走同一列，不需要新表。
3. **样本必须可追溯**。每条样本记录 `source`、`account_id`、`collector_run_id`、`collected_at`。出风控问题时必须能回答"这条数据是哪次运行、用哪个号、几点拿到的"。
4. **指标用宽表 + `extra JSONB`**，不做 EAV、不一个指标一行。宽表查询快、图表 SQL 简单；未来 B 站新增指标放 `extra`，不用改表。

## 4. 数据模型（迁移 `006_real_collector.sql`）

### 4.1 新表

```sql
CREATE TABLE bili_accounts (
  id UUID PRIMARY KEY,
  mid BIGINT UNIQUE,                     -- 登录成功后才知
  uname TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','expired','revoked','blocked')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  cookie_expires_at TIMESTAMPTZ,         -- 从 Set-Cookie/登录返回推断
  last_verified_at TIMESTAMPTZ,          -- 最近一次 nav 校验
  last_used_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 只能有一个启用的默认账号
CREATE UNIQUE INDEX bili_accounts_one_default
  ON bili_accounts ((is_default)) WHERE is_default AND status = 'active';

CREATE TABLE bili_account_secrets (
  account_id UUID PRIMARY KEY REFERENCES bili_accounts (id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> 凭据**绝不进日志、绝不进 API 响应、绝不入库明文**。加密：AES-256-GCM，密钥来自 `COLLECTOR_SECRET_KEY`（32 字节，base64），`key_version` 为将来轮换预留。
> 本包不实现二维码登录接口/页面，但这张表的形状现在定死，避免以后返工。

```sql
CREATE TABLE bili_login_sessions (        -- 供下一包二维码登录页使用，本包只建表
  id UUID PRIMARY KEY,
  qrcode_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','scanned','confirmed','expired','failed')),
  account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  error TEXT
);
```

```sql
CREATE TABLE collector_requests (        -- 每个上游请求一行，用于审计与限频分析
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,                -- 'view' | 'online' | 'relation_stat' | 'nav'
  status_code INT,
  biz_code INT,                          -- B 站 JSON 里的 code
  duration_ms INT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT
);
CREATE INDEX collector_requests_account_at ON collector_requests (account_id, requested_at DESC);

CREATE TABLE collector_circuits (        -- 风控熔断状态，重启后仍然有效
  account_id UUID PRIMARY KEY REFERENCES bili_accounts (id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resume_at TIMESTAMPTZ NOT NULL,
  consecutive_failures INT NOT NULL DEFAULT 1,
  reason TEXT NOT NULL
);
```

### 4.2 修改现有表

```sql
ALTER TABLE monitor_targets
  DROP CONSTRAINT IF EXISTS monitor_targets_source_check,
  ADD CONSTRAINT monitor_targets_source_check CHECK (source IN ('offline','bilibili')),
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL;

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS cid BIGINT,
  ADD COLUMN IF NOT EXISTS pubdate TIMESTAMPTZ;
```

> `videos.cid` 必须是独立列：在线观看接口按 `bvid + cid` 查询，每次都靠 metadata JSON 里翻是不行的。

```sql
ALTER TABLE video_metric_samples
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import'
    CHECK (source IN ('import','legacy_csv','bilibili')),
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;
-- comment_count 已由 003 存在，本包负责真正填值

ALTER TABLE creator_follower_samples
  ADD COLUMN IF NOT EXISTS following_count BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'import'
    CHECK (source IN ('import','legacy_csv','bilibili')),
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES bili_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_run_id UUID REFERENCES collector_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS video_samples_run ON video_metric_samples (collector_run_id);
CREATE INDEX IF NOT EXISTS creator_samples_run ON creator_follower_samples (collector_run_id);
CREATE INDEX IF NOT EXISTS video_samples_source_at ON video_metric_samples (source, sampled_at DESC);
```

`monitor_targets.interval_minutes` 已有枚举（5/15/30/60/180/360/720/1440），沿用，不改。

### 4.3 时间语义（重要）

- `sampled_at` = **任务计划时刻（时间桶）**，来自 `collector_jobs.scheduled_for`。它是幂等键：`(bvid, sampled_at)` / `(mid, sampled_at)` 唯一，重跑/重启不会写重复行。
- `collected_at` = 真正拿到数据的时刻，允许比 `sampled_at` 晚几十秒。
- 全部 `TIMESTAMPTZ`；展示时按 `Asia/Shanghai`。CSV 导入要按 `Asia/Shanghai` 解析，不能当 UTC。

## 5. 采集端点与字段映射

| 用途 | 端点 | 关键参数 | 取什么 | 说明 |
| --- | --- | --- | --- | --- |
| 视频元数据 + 全部互动指标 | `GET https://api.bilibili.com/x/web-interface/view` | `bvid` | `data.cid`、`data.pubdate`、`data.title`、`data.owner.mid`、`data.stat.{view,danmaku,reply,favorite,coin,share,like}` | **一次请求拿全**，评论数就是 `stat.reply`。旧代码重复调了两次，不要学 |
| 实时在线观看 | `GET https://api.bilibili.com/x/player/online/total` | `bvid`、`cid` | `data.total`（数字或 `"1234+"` 字符串） | 只对发布 14 天内的视频调用；数字入 `online_viewers`，原文入 `online_viewers_raw` |
| UP 主粉丝/关注 | `GET https://api.bilibili.com/x/relation/stat` | `vmid` | `data.follower`、`data.following` | 不需要 WBI；逐 mid 串行 |
| 登录态校验（账号模块） | `GET https://api.bilibili.com/x/web-interface/nav` | — | `data.isLogin`、`data.mid`、`data.uname`、`data.face` | 只用于校验 Cookie 是否仍有效 |

**为什么查询逻辑要这么写：**

1. `/x/web-interface/view` 已经把视频所有公开统计一次返回，**每个视频每轮只需 1 次请求**。频率预算要花在时间密度上，不是重复请求上。
2. `/x/player/online/total` 依赖 `cid`，是额外的一次请求，且它只是"当前在线人数下界"，对老视频几乎没有信息量。所以只在 `pubdate` 距今 ≤ 14 天（或目标显式开启）时采。
3. `relation/stat` 很轻，但**必须慢**：旧脚本在两个 mid 之间 `sleep(30)`，这就是它能活一年的原因。新实现按账号做全局节流，不要因为"内部服务"就并发打。
4. 这三个接口**都不需要 WBI 签名**。不要顺手给它们加 `w_rid`（多余参数会被风控注意）。WBI 只在 `reply/wbi/main` 这类接口才需要，本包用不到。
5. 所有请求必须带 `User-Agent`（移动端或桌面 Chrome UA）与 `Referer: https://www.bilibili.com/`，否则 `-352`。
6. Cookie 的作用是提高配额和降低风控概率；未登录也能读公开数据，但高频必被拦。因此**有账号就带上，没有账号就降频**，不要硬刚。

## 6. 采集执行逻辑（collector 内部）

### 6.1 主循环

1. 心跳：每 10 秒写 `collector_heartbeats`（`starting|idle|running`）。
2. 取任务：`SELECT ... FROM collector_jobs WHERE status='pending' AND scheduled_for <= now() ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1`，置 `running`。
3. 执行：按 `target.type` 走视频或 UP 主流程；写样本（`ON CONFLICT DO NOTHING`）。
4. 收尾：写 `collector_runs`（`samples_written`、`duration_ms`、`error`），更新 job 状态与 `monitor_targets.last_run_at/last_success_at/last_error/next_run_at`。
5. 空闲：没有到期任务时 sleep 1s，不要让数据库空转。

**目标到期建模**：`monitor_targets.next_run_at` 到点后由 worker 生成一条 job（`UNIQUE(target_id, scheduled_for)` 天然去重），然后 `next_run_at = next_run_at + interval_minutes`。不要在 API 侧预生成一堆任务。

### 6.2 视频流程

```
load target → 取 account（target.account_id ?? 默认账号）
  ├─ 无 videos 行或 cid 为空 → 调 view 拿元数据（同时已有 stat）
  ├─ 正常一轮 → 调 view 拿 stat
  ├─ 若 pubdate 在 14 天内 → 再调 online/total
  └─ upsert videos（title/mid/cid/pubdate/封面）→ insert sample
```

字段映射：`view→view_count`、`danmaku→danmaku_count`、`reply→comment_count`、`favorite→favorite_count`、`coin→coin_count`、`share→share_count`、`like→like_count`。

### 6.3 UP 主流程

`relation/stat` → `follower_count`、`following_count` → upsert `creators`（首次拿 `uname`/`face` 时可调 `card`，可选）→ insert sample。

### 6.4 错误处理（必须按类别，不许无脑重试）

| 情况 | 行为 |
| --- | --- |
| 网络超时 / 5xx | 本次 run 失败，`attempts+1`，退避 `min(2^attempts, 30)` 分钟后重排 |
| `code = -404`（稿件不存在/私密） | 目标置 `enabled=false`，`last_error` 记录，不重试 |
| `code = -352 / -412`（风控） | 打开 `collector_circuits`，默认冷却 30 分钟；期间该账号所有任务延迟 |
| `code = -509`（超频） | 冷却 60 分钟 |
| `code = -101`（未登录） | 账号 `status='expired'`，该账号任务暂停，等重新登录 |
| 单次 run 连续失败 ≥ 3 | job `failed`，`last_error` 可见；等下一个 `next_run_at` |

### 6.5 节流（必须实现，可测试）

- 每个账号全局最小请求间隔：**1500ms + 0~800ms 抖动**（`Math.random` 可注入，便于测试）。
- 同一账号串行，不并发；不同账号可并行（但本包单实例默认 1 并发）。
- 每分钟每账号请求上限：**20 次**（超过就等，不要丢任务）。
- 支持 `COLLECTOR_DRY_RUN=1`：不发真实请求，只打印将要请求的 URL 与参数。

## 7. 账号与凭据（本包只做存储与选择）

- 默认账号：`bili_accounts.is_default = true`（唯一）；目标 `account_id` 为空时用它。
- `COLLECTOR_ACCOUNT_ID` 环境变量可强制指定（调试用）。
- 加密读写放 `packages/monitoring/src/credentials.ts`：`encryptCookieJar` / `decryptCookieJar`，密钥缺失时**直接启动失败**，不允许降级为明文。
- 本包**不实现**二维码登录的 HTTP 接口与页面；但要提供 **CLI**（`bun run apps/collector/src/cli.ts login --qr`）能生成二维码到终端/PNG，供 Hermes 首次拿凭据与本地调试。二维码流程按 `reference/bilibili-api/QR.md`：

```
GET  https://passport.bilibili.com/x/passport-login/web/qrcode/generate  → {url, qrcode_key}
GET  https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...
     code 86101 未扫码 / 86090 已扫码待确认 / 86038 已过期 / 0 成功（Set-Cookie 即凭据）
```

登录成功后：用 `nav` 拿 `mid/uname/face` 填 `bili_accounts`，把 Cookie 加密写 `bili_account_secrets`，`status='active'`。

## 8. 历史 CSV 导入（把旧系统 1 年的数据接上）

- 来源：`D:\App\scripts\v2\*.csv`，已复制到 `\\192.168.0.135\Data\_hermes_inbox\legacy_csv\`（45 个 `*_views.csv`、55 个 `*_follower.csv`）。
- 格式：UTF-8 **带 BOM**、CRLF；`时间,播放量,在线观看人数,点赞,投币,收藏,分享,弹幕` / `时间,粉丝数`；时间精确到分钟，**东八区本地时间**。
- 导入：`bun run apps/collector/src/cli.ts import-legacy --dir /legacy-csv`
  - 每文件一行 `import_batches`（`mode='apply'`，`report_json` 记录文件名与行数）；
  - `sampled_at` 按 `Asia/Shanghai` 解析；`source='legacy_csv'`；`collected_at=NULL`；
  - `comment_count` 一律 `NULL`（旧系统没采，明确留空，不要填 0）；
  - 幂等：`ON CONFLICT (bvid, sampled_at) DO NOTHING`；
  - 同名视频同时存在旧 CSV 与真实采集时，真实采集优先（冲突即跳过，不覆盖）；
  - 输出对账：每个文件行数 / 入库数 / 冲突数 / 拒绝数，以及全局最早最晚 `sampled_at`。

## 9. 配置项（env）

```
COLLECTOR_PROVIDER=offline|bilibili        # 默认 offline，部署时才切
COLLECTOR_INSTANCE_ID=collector-1
COLLECTOR_SECRET_KEY=<base64 32B>          # 缺省时仅 offline 模式可启动
COLLECTOR_MIN_INTERVAL_MS=1500
COLLECTOR_MAX_JITTER_MS=800
COLLECTOR_MAX_REQUESTS_PER_MINUTE=20
COLLECTOR_DRY_RUN=0|1
COLLECTOR_HTTP_TIMEOUT_MS=10000
COLLECTOR_ONLINE_WINDOW_DAYS=14
```

`offline` 模式下保持现有行为（现有离线 provider 与测试不能坏）。

## 10. 测试要求（CI 必须完全离线）

必须覆盖：

1. 视频样本解析：`view/stat` 夹具 → 七个指标 + `comment_count` 正确；
2. `online.total` 为 `"1234+"` 字符串时，`online_viewers=1234`、`online_viewers_raw="1234+"`；
3. 时间桶幂等：同一 job 重跑两次只落一行；
4. 限频：注入假时钟，断言两次请求间隔 ≥ 最小值、每分钟不超过上限；
5. 熔断：`-352` 后同账号后续任务被推迟，冷却结束恢复；
6. `-404` 目标自动停用；
7. Cookie 加解密 round-trip；缺密钥时启动报错；
8. 历史 CSV：BOM + CRLF + 东八区解析 + 幂等 + 评论数留 NULL；
9. 网络守卫只放行 `api.bilibili.com` / `passport.bilibili.com`；其他域名直接抛错；
10. 现有离线 collector 测试全部保持通过。

## 11. 验收标准（Hermes 会独立验证，不看你自述）

- `bun run typecheck / test / build / format:check / lint` 全绿；
- 迁移在空库与现有库（含 001–005 数据）都能重复执行；
- `COLLECTOR_PROVIDER=offline` 时，现有端到端行为不变；
- `bilibili` 模式在**没有真实网络**的环境下，用注入的假 transport 能跑通完整 job → run → sample 链路；
- 在真实测试栈里，切到一个真实账号后，能在 1 分钟内看到新样本、`comment_count` 非空；
- 日志里不出现 Cookie、`SESSDATA`、`bili_jct`、密钥。

## 12. 禁止事项

- 禁止把 `cookie.txt` / `session.json` / `SESSDATA` 或任何真实凭据写进仓库、测试夹具、日志、错误信息。
- 禁止在 CI 里请求真实 B 站。
- 禁止改 `apps/web` 的界面（本包不做 UI）；如需为 `accountId` 改契约，只改 `packages/contracts` 与 API。
- 禁止动商单发布侧 `monitor_jobs` / `project_monitor_contracts` 的语义。
- 禁止把采集逻辑塞进 API 进程；worker 必须能独立启动。
- 禁止无上限重试、禁止并发轰炸同一账号。

## 13. 参考资料（必读，按顺序）

1. `reference/legacy-collector/main.py` — 视频采集主逻辑（CID 缓存、view/stat 解析、CSV 落盘、失败填 0 的取舍）。
2. `reference/legacy-collector/follower_monitor.py` — 粉丝采集与**请求间隔 30 秒**的实证。
3. `reference/legacy-collector/dynamic_monitor.py` — 二维码登录、`bili_ticket`、WBI 签名、`reply/wbi/main`；本包只用登录部分作参考。
4. `reference/legacy-collector/analyze.py` / `batch_ups_fetch.py` — 历史数据规模与 UP 批量查询方式。
5. `reference/bilibili-api/*.md` — 接口文档（社区维护的 wild API 文档，固定 commit `cfc5fddcc8a94b74d91970bb5b4eaeb349addc47`，上游 `https://github.com/BACNext/bilibili-API-collect-backup`）。**所有字段名以文档 + 实测为准，不要凭记忆写。**
6. 旧系统产出的 CSV 样本：`reference/legacy-collector/samples/`（各 1 个视频与粉丝文件，仅样例）。

## 14. 建议提交顺序

1. `006_real_collector.sql` + `packages/db` 查询层（目标、账号、样本写入）；
2. `packages/monitoring`：`bilibili-provider`（transport 可注入）、`throttle`、`circuit`、`credentials`；
3. `apps/collector`：provider 切换、job 执行改造、CLI（login / import-legacy）；
4. 测试与夹具；
5. `docs/architecture/real-collector.md`：写清端点、频率、错误码、时间语义，以及与旧 Python 的差异（**必须写"为什么"**）。

完成后在 PR 描述里逐条回答：旧代码哪些设计被保留、哪些被替换、评论数从哪个字段来、风控怎么处理、时间桶为什么这样定。
