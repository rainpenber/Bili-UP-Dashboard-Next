# 媒体代理与头像/封面回填（WP-R2-27A / 27A2）

## 写入路径

- 投稿同步 / 发现：空间投稿列表 `pic` → `videos.cover_url`，`cover_state='ok'`。
- UP 名片：`x/web-interface/card?mid=`（失败回退 `x/space/acc/info`）→ `creators.face_url`，`metadata_state='ok'`。
- `POST /api/v1/monitor/creators/:mid/media/backfill`：幂等、TTL 6h、最近 ≤100 条封面；写入 URL 后**复用 metadata-refresh 同源资源化**（`downloadHdslbImage` + `storeImageBytes`），回写 `creators.face_asset_id` / `videos.cover_asset_id`。
- 资源化失败（404 / 超时 / 过小文件等 `ImageReject`）记 `metadata_error`、封面 `cover_state='failed'`，**不**让整轮回填失败。
- `force=1`（query 或 body）：绕过 TTL；对历史 `cover_state='ok'` 但 `cover_asset_id IS NULL` 的行重新资源化。
- 同一 URL / 已有 `asset_id` 复用，不重复下载；再次 `force` 时 `assetsReused>0`，`static_assets` 行数不增加。
- 响应字段：`faceAssetId`、`coversAssetized`、`coversFailed`、`assetsReused`（另有既有 `faceUrl` / `coversUpdated` / `cached` 等）。

## 图片代理

`GET /api/v1/media/image?url=<encoded>[&w=…]`

- 仅允许 `*.hdslb.com` / `*.bilibili.com`；拒绝 IP / localhost / 内网主机。
- 服务端带 `Referer: https://www.bilibili.com/` 抓取；超时 10s；体积极限同 `MAX_IMAGE_BYTES`。
- `Cache-Control: public, max-age=86400`；进程内 LRU ≥200；不落盘、不入库。
- 契约：`bilibiliMediaProxyUrl(raw)`；卡片字段 `imageUrl`（原始）+ `imageProxyUrl`（代理）。

## 动态同步

`GET/POST /api/v1/monitor/creators/:mid/dynamics/sync`：最近 30 条 / 最多 2 页，写 `creator_publish_events`（`event_kind=dynamic`，`source=bilibili`），不覆盖手动事件，不建监控目标。
