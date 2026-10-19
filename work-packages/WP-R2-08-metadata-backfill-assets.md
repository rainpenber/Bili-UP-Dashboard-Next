# WP-R2-08 历史元数据回填与图片资产落地

> 基线：WP-R2-07 的分支（迁移 007、`app_logs`、`/ops` 已就绪）。
> 本包**会发真实请求**，因此默认 `--dry-run`；真正执行由 Hermes 在用户批准后跑，Agent 只写代码与离线测试。

## 1. 要解决的问题

旧 CSV 只留下 BV 号与 mid。目前库里：

- 45 个视频（`<BV>_views.csv`）→ 无标题、无封面、无标签、无 cid/pubdate、无简介/时长；
- 55 个 UP 主（`<mid>_follower.csv`）→ 无昵称、无头像。

用户要求：**把这些原始信息找回来**，并明确「先拿到 CID，才能查在线人数」。因此回填必须一次把 `cid`、标题、封面、标签、简介、时长、作者一起补全。

## 2. 已验证的接口事实（2026-10-19 实测 `BV1jHnn63EEi`，勿凭记忆改）

`GET https://api.bilibili.com/x/web-interface/view/detail?bvid=<BV>`，无需登录、无需 WBI，一次返回：

```
data.View = { bvid, aid, cid, title, pubdate, duration, tname, pic, desc,
              owner: { mid, name, face },
              stat: { view, danmaku, reply, favorite, coin, share, like } }
data.Tags = [ { tag_id, tag_name, ... } ]   // 7 条
data.Related = [...]                        // 忽略
```

- `cid` 在同一响应里，**不要再单独调一次**。
- `tname` 实测为空字符串，不能拿它当分区；分区留空或取 `View.tname` 原样，禁止伪造。
- `pic` 可能是 `http://i1.hdslb.com/...`，保存前升级成 `https://`。
- 封面/头像走 CDN，**不需要 Cookie**；禁止把 `SESSDATA`/`bili_jct` 带到图片域名（泄露风险）。
- 请求头固定：桌面 UA + `Referer: https://www.bilibili.com/`。
- 错误分类沿用 006：`-404` 目标失效、`-352`/`-412` 风控、`-509` 超频、`-101` 未登录。

UP 主资料（昵称/头像）优先从视频的 `owner` 顺手拿到；对于只有 mid 的 55 个 UP 主，用 `GET /x/relation/stat?vmid=<mid>` 拿粉丝/关注，昵称与头像尝试 `GET /x/web-interface/card?mid=<mid>`（若实测返回 `card.name`/`card.face` 则采用；若接口不可用，`metadata_state='partial'`，只存粉丝数，绝不编造昵称）。

## 3. 图片存储（用户明确问过「图片怎么存」）

**结论：内容寻址 + 本地文件 + 数据库索引 + 只存相对路径，原图不转码。**

- 落盘路径：`${ASSETS_ROOT}/bili/<kind>/<sha[0:2]>/<sha256>.<ext>`，`kind ∈ {cover, face}`；sha256 为**下载字节**的哈希，相同图片自动去重（45 个视频里同款封面/同一 UP 头像只存一份）。
- `static_assets` 写：`asset_id = assetIdFromContentSha256(sha)`、`content_sha256`、`mime_type`、`byte_size`、`width`、`height`、`source_url`、`fetched_at`、`origin='bilibili'`、`kind`。
- `videos.cover_asset_id` / `creators.face_asset_id` 指向资产；`videos.cover_url` / `creators.face_url` 保留原始 URL 兜底。
- 读取仍走现有 `GET /api/v1/assets/:assetId`，但补：`Cache-Control: public, max-age=31536000, immutable`（内容寻址可长缓存）、`ETag`、`Content-Length`；缺失时保持现有占位 SVG，不返回 500。
- 安全限制：只接受 `https`；域名白名单 `*.hdslb.com`（跟随重定向后校验最终 URL）；`Content-Type` 必须是 `image/jpeg|png|webp`；文件头魔数校验；单文件上限 8 MiB；超时 10 s；超限/非法直接失败并记 `cover_state='failed'`，**不落盘**。
- 备份：`ASSETS_ROOT` 是挂载卷（compose 增加 `assets` volume，默认 `./data/assets`）；数据库只存相对路径，换机器只需搬目录。文件写入用「临时文件 + rename」保证原子性。
- 不做缩略图/多尺寸：现在不需要，将来派生即可（原图是唯一真相）。

## 4. 回填 CLI（`apps/collector/src/cli.ts` 扩展）

```
bun run apps/collector/src/cli.ts backfill metadata --kind video --dry-run
bun run apps/collector/src/cli.ts backfill metadata --kind video --bvid BV1xxx
bun run apps/collector/src/cli.ts backfill metadata --kind video --dir /legacy
bun run apps/collector/src/cli.ts backfill metadata --kind creator --dir /legacy --limit 10
```

规则：

- 选取顺序：显式 `--bvid`/`--mid` > `--dir` 下的文件名（`<BV>_views.csv`、`<mid>_follower.csv`）> `--all-missing`（`metadata_state <> 'ok'`）。
- 每个视频：1 次 `view/detail` → 写 `videos`（title/desc/duration/cid/pubdate/mid/cover_url/cover_state=pending/metadata_state=ok/metadata_source='bilibili'/metadata_fetched_at）+ 覆盖 `video_tags`（先删后插，ordinal 保留接口顺序）+ 下载封面并回写 `cover_asset_id/cover_state`。
- 每个 UP 主：`relation/stat` 写粉丝/关注样本；`card` 成功则写 `uname/face_url` 并下载头像；失败则 `metadata_state='partial'`。
- 节奏：请求间隔 `2000ms ± 500ms` 随机，串行；每 `50` 条暂停 `30s`（参数可调）；`--limit` 截断。
- 失败：单条失败不中断，写 `metadata_state='failed'` + `metadata_error`（≤500 字），`report` 记录；遇到 `-352/-412/-509` **立即停止整批**，`backfill_runs.status='aborted'`，避免把账号打死。
- 幂等：重复执行不会重复插标签、不会重复下同一张图（同 sha 直接命中）；`metadata_state='ok'` 的默认跳过，除非 `--force`。
- 全程写 `backfill_runs`（requested/succeeded/failed/skipped/report）与 `app_logs`；日志里只出现 BV/mid，不出现 Cookie。
- `--dry-run`：只打印将要处理的清单与预计请求数，**零网络请求**。

## 5. 测试（离线）

- 用伪造 transport 返回固化的 `view/detail` JSON（含 Tags、空 tname、http 图片地址）→ 断言 cid/title/pubdate/duration/desc/owner 写入正确、7 条标签入库且顺序保留、重复执行不产生重复标签。
- 图片：用 1×1 PNG / 3×2 JPEG 固件测 sha 去重、`static_assets` 字段、第二次下载命中不写盘；构造 `text/html`、`image/gif`、超 8 MiB、非 hdslb 域名、`http://` 五种拒绝路径。
- 空 tname 不写假分区；`-352` 触发整批中止；`--limit` 生效；`--dry-run` 期间断言 fetch 调用次数为 0。
- 迁移 007 在本包再次执行仍幂等；全部门槛命令通过。

## 6. 不做

- 不采评论列表、不做 WBI 签名接口、不改采集频率。
- 不删历史样本、不改 CSV 导入语义（导入仍然只负责指标）。
- 不在本包内对真实 B 站批量执行；执行与验收由 Hermes 在用户批准后完成。
