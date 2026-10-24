# 媒体代理与头像/封面回填（WP-R2-27A）

## 写入路径

- 投稿同步 / 发现：空间投稿列表 `pic` → `videos.cover_url`，`cover_state='ok'`。
- UP 名片：`x/web-interface/card?mid=`（失败回退 `x/space/acc/info`）→ `creators.face_url`，`metadata_state='ok'`。
- `POST /api/v1/monitor/creators/:mid/media/backfill`：幂等、TTL 6h、最近 ≤100 条封面；不落盘、不写 `static_assets`。

## 图片代理

`GET /api/v1/media/image?url=<encoded>[&w=…]`

- 仅允许 `*.hdslb.com` / `*.bilibili.com`；拒绝 IP / localhost / 内网主机。
- 服务端带 `Referer: https://www.bilibili.com/` 抓取；超时 10s；体积极限同 `MAX_IMAGE_BYTES`。
- `Cache-Control: public, max-age=86400`；进程内 LRU ≥200；不落盘、不入库。
- 契约：`bilibiliMediaProxyUrl(raw)`；卡片字段 `imageUrl`（原始）+ `imageProxyUrl`（代理）。

## 动态同步

`GET/POST /api/v1/monitor/creators/:mid/dynamics/sync`：最近 30 条 / 最多 2 页，写 `creator_publish_events`（`event_kind=dynamic`，`source=bilibili`），不覆盖手动事件，不建监控目标。
