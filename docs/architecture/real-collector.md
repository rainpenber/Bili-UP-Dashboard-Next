# 真实数据采集

WP-R2-06。Collector 仍是独立进程，只通过 PostgreSQL 与 API 交换目标、任务和样本。`COLLECTOR_PROVIDER=offline` 保持原来的离线适配器。`COLLECTOR_PROVIDER=bilibili` 才走下面这条链路。迁移只由 API 启动时执行；Collector 发现表不存在时有界等待，不会自己建表。

## 为什么查询要拆成这三次

视频公开指标已经集中在 `GET /x/web-interface/view`。`data.stat` 里同时有播放、弹幕、评论、收藏、投币、分享、点赞，`data` 上还有 `cid`、`pubdate`、`title`、`owner` 和封面 `pic`。每一轮每个 BV 只打这一次，频率预算才能花在采样密度上。旧脚本把同一接口打了两次（一次拿 cid，一次拿 stat），还漏了 `stat.reply`。

`GET /x/player/online/total` 必须带 `bvid` 和 `cid`，所以它发生在 `view` 之后。它给出的是当前在线人数下界。**每一轮都要采**，不按发布年龄截断：老视频也可能突然爆火，那正是不能漏掉的时刻。返回值可能是数字，也可能是 `"1234+"`：整数写入 `online_viewers`，原文写入 `online_viewers_raw`。调用失败或业务码不是 0 时，`online_viewers` 写 NULL，原文能解析就保留，不能解析就留空。不要写成 0，否则图表会显示一次虚假的下跌。

`GET /x/relation/stat?vmid=` 很轻，但旧粉丝脚本能稳定跑一年，靠的是两个 mid 之间 `sleep(30)`。新实现不按脚本写死 30 秒，而是按账号做全局节流：同一账号串行，最小间隔 `COLLECTOR_MIN_INTERVAL_MS`（1500）再加 `0..COLLECTOR_MAX_JITTER_MS`（800）抖动，并且每分钟不超过 `COLLECTOR_MAX_REQUESTS_PER_MINUTE`（20）。没有 Cookie 时最小间隔至少 5 秒，因为未登录配额更低。

这三个接口都不需要 WBI。`w_rid` / `wts` 是多余参数，风控会注意到。WBI 只留给 `reply/wbi/main` 这类接口，本包不采评论列表。每个请求带桌面 Chrome `User-Agent` 和 `Referer: https://www.bilibili.com/`，否则容易直接 `-352`。

Cookie 的作用是抬高配额、降低风控概率。公开数据未登录也能读，所以没有账号时仍采集，只是更慢。有账号就带上该账号的 Cookie。账号凭据用 AES-256-GCM 存在 `bili_account_secrets`，密钥是 `COLLECTOR_SECRET_KEY`（32 字节 base64）。`bilibili` 模式缺少密钥直接拒绝启动；`offline` 模式不读这把密钥。

网络出口只允许 `api.bilibili.com` 和 `passport.bilibili.com`。其它主机，包括封面 CDN，在传输层直接抛错。封面 URL 只入库，不下载。

## 字段映射

| 端点                     | 响应字段                                              | 列                                                              |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------------------- |
| `/x/web-interface/view`  | `data.stat.view`                                      | `video_metric_samples.view_count`                               |
| 同上                     | `data.stat.danmaku`                                   | `danmaku_count`                                                 |
| 同上                     | `data.stat.reply`                                     | `comment_count`                                                 |
| 同上                     | `data.stat.favorite`                                  | `favorite_count`                                                |
| 同上                     | `data.stat.coin`                                      | `coin_count`                                                    |
| 同上                     | `data.stat.share`                                     | `share_count`                                                   |
| 同上                     | `data.stat.like`                                      | `like_count`                                                    |
| 同上                     | `data.cid`                                            | `videos.cid`                                                    |
| 同上                     | `data.pubdate`（Unix 秒）                             | `videos.pubdate`                                                |
| 同上                     | `data.title`                                          | `videos.title`                                                  |
| 同上                     | `data.owner.mid`                                      | `videos.mid`                                                    |
| 同上                     | `data.owner.name`                                     | `creators.uname`                                                |
| 同上                     | `data.pic`                                            | `videos.metadata.pic`                                           |
| 同上                     | `data.tid` / `data.tid_v2`                            | `videos.tid` / `videos.tid_v2`，并写入 `videos.metadata`        |
| 同上                     | `data.tname` / `data.tname_v2`                        | 原始快照写入 `videos.metadata`。非空真名才写入 `partition_name` |
| `/x/player/online/total` | `data.total` 的数字部分；失败或 `code != 0` 时为 NULL | `online_viewers`                                                |
| 同上                     | `data.total` 原文；没有原文则留空                     | `online_viewers_raw`                                            |
| `/x/relation/stat`       | `data.follower`                                       | `creator_follower_samples.follower_count`                       |
| 同上                     | `data.following`                                      | `following_count`                                               |
| `/x/web-interface/nav`   | `data.mid` / `uname` / `face` / `isLogin`             | `bili_accounts.mid` / `uname` / `avatar_url`，并校验 Cookie     |

`sampled_at` 取 `collector_jobs.scheduled_for`，是幂等键。同一任务重跑命中 `(bvid, sampled_at)` 或 `(mid, sampled_at)` 时 `ON CONFLICT DO NOTHING`，不覆盖已有行。`collected_at` 是这次真正拿到响应的时刻，可以晚于时间桶。历史 CSV 的 `collected_at` 留空，因为旧文件里没有“抓取时刻”，只有分钟级本地时间。

## 为什么按年龄分级

刚发布的视频播放和在线人数以分钟变化，这是判断要不要投流的窗口。过了起量期，曲线变平，继续 15 分钟打一次只是在消耗配额。所以视频目标默认 `interval_mode='auto'`，下一次 `next_run_at` 在**每次排期时**按当时的 `videos.pubdate` 重算：

| 年龄                       | 间隔     |
| -------------------------- | -------- |
| ≤ 3 天，或还没有 `pubdate` | 15 分钟  |
| 3 天到 14 天（含）         | 120 分钟 |
| 超过 14 天                 | 360 分钟 |

跨过 3 天或 14 天不需要人工改配置，也不需要后台任务：下一次排期自己变慢。`interval_mode='fixed'` 才使用 `interval_minutes`。立即采集只插一条当前任务，不改这个模式。UP 主没有年龄，`auto` 模式是 240 分钟，对应旧脚本的每 4 小时；要改间隔就切到 `fixed`。

阈值在 `packages/monitoring/src/frequency.ts`，环境变量是 `COLLECTOR_TIER1_MAX_DAYS`、`COLLECTOR_TIER1_MINUTES`、`COLLECTOR_TIER2_MAX_DAYS`、`COLLECTOR_TIER2_MINUTES`、`COLLECTOR_TIER3_MINUTES`、`COLLECTOR_CREATOR_INTERVAL_MINUTES`。005 的间隔枚举装不下 120，006 把检查改成 `interval_minutes BETWEEN 5 AND 10080`。这是计划频率。账号上的 1500ms 间隔和每分钟 20 次上限是另一层风控，两者不要混用。

## 错误与熔断

| 情况                        | 行为                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 超时或 HTTP 5xx             | 本次 run 失败，`min(2^attempts, 30)` 分钟后重试，连续失败达到 `COLLECTOR_MAX_ATTEMPTS`（默认 3）后 job `failed` |
| 业务码 `-404` 或 HTTP 404   | 目标 `enabled=false`，不重试                                                                                    |
| `-352` / `-412`             | 写入 `collector_circuits`，冷却 30 分钟。重启后仍然有效。冷却期内该账号的任务被推迟，不消耗重试次数             |
| `-509`                      | 同样熔断，冷却 60 分钟                                                                                          |
| `-101`                      | 账号 `status=expired`，该账号的任务推迟，直到重新登录                                                           |
| `view` 成功但 `online` 失败 | 仍写入 view 样本。在线人数留空。若在线接口本身触发风控或未登录，账号侧的熔断或过期照常生效                      |

`collector_requests` 记录每次上游调用的端点、HTTP 状态、业务码和耗时。错误文本会去掉 `SESSDATA`、`bili_jct` 和密钥，日志同样处理。

## 凭据与历史 CSV

CLI：

```bash
COLLECTOR_SECRET_KEY=... bun run apps/collector/src/cli.ts login --qr
bun run apps/collector/src/cli.ts import-legacy --dir /path/to/csv
```

`login --qr` 走 passport 的 `qrcode/generate` 与 `qrcode/poll`（86101 未扫、86090 已扫未确认、86038 过期、0 成功），从 `Set-Cookie` 取凭据，再用 `nav` 填写 mid / 昵称 / 头像，加密后写入 `bili_account_secrets`。二维码打到终端并写成 PNG。登录 URL 里的 `qrcode_key` 不进普通日志。

`import-legacy` 接受 UTF-8 BOM 和 CRLF。`*_views.csv` 与 `*_follower.csv` 的时间按 `Asia/Shanghai`、分钟精度解析。`source='legacy_csv'`，`comment_count` 保持 NULL（旧系统没采，不能填 0）。每个文件一行 `import_batches`（`mode='apply'`）。冲突计数来自 `ON CONFLICT DO NOTHING`，已有的真实样本不会被 CSV 覆盖。

`COLLECTOR_DRY_RUN=1` 只打印将要请求的 URL，不调用传输层。

## 和旧 Python 的差别

保留：

- 视频用 `/x/web-interface/view`，在线用 `/x/player/online/total`，粉丝用 `/x/relation/stat`。
- `"1234+"` 解析成整数下界，同时记住原文。
- 单账号串行，失败不立刻连打。
- 粉丝查询故意慢。
- 稿件不存在就停掉这个目标，而不是一直重试。
- CSV 的列顺序、东八区分钟时间和“没采到的评论不要写成 0”。

替换：

- 每轮视频只请求一次 `view`。评论数来自 `stat.reply`，写入 `comment_count`。
- cid 存在 `videos.cid`，不再写回 ini 文件，也不为了 cid 多打一次 `view`。
- 在线人数每一轮都采。失败或业务码非 0 时 `online_viewers` 为 NULL，不再用 0 填充。
- 视频采集间隔按发布年龄自动变成 15 分钟、2 小时、6 小时；UP 主自动模式是 4 小时。`fixed` 才沿用手工间隔。
- Cookie 加密进库，可以有多个账号，并记住是哪一个账号写出的样本。
- 风控码打开持久化熔断，进程重启后仍然生效。
- 时间桶用任务的 `scheduled_for`，真正的抓取时刻单独放在 `collected_at`。
- 不落 CSV，不使用 `schedule`，不实现 WBI、`bili_ticket` 或评论接口。

单元测试和 CI 只使用注入的传输层和录制夹具，不会请求 B 站。

## 分区名

2026-10-19 实测 `BV1jHnn63EEi`：`view` 与 `view/detail` 的 `tname`、`tname_v2` 都是空字符串，但 `tid=95`、`tid_v2=2102` 有值。`/x/v2/region/index` 已返回 `-400`，不能再当分区字典用。

`videos.partition_name` 只存去掉首尾空白后的真名。空串、纯空白、`未知`、`其他`、`其它` 写成 NULL，不拿它们充数。原始四个字段留在 `videos.metadata`，方便以后对照。读视频时若 `partition_name` 为空，先按 `tid_v2` 再按 `tid` 左连 `bili_partitions`；字典也没有名字就返回 null。

字典不联网抓。维护者用本地 JSON 导入：

```bash
bun run seed-partitions -- --file partitions.json
```

文件可以是数组，或 `{ "partitions": [...] }`。每行 `tid`、可选 `parentTid`、`name`、`source`（`bilibili` / `import` / `manual` / `unknown`，缺省 `manual`）。假名导入后存成 NULL。

运行记录、心跳和请求审计的只读查询在 `/api/v1/ops`。日志级别、脱敏和 `app_logs` 写入策略见 [observability.md](./observability.md)。采集频率、熔断和样本写入仍按本文。
