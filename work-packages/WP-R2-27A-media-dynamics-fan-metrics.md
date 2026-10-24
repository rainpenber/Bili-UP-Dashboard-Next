# WP-R2-27A — 采集补齐（头像/封面）+ 视频列表过滤 + 动态命名与回填 + 全量粉丝数据

基线：PR #69 head `c0c05b8`。只改 API/DB/provider/contracts；不改图表前端（27B）。

## 范围

1. **头像/封面**：投稿同步与发现写 `pic`→`videos.cover_url`；名片/空间信息写 `creators.face_url`；`POST .../media/backfill` 回填最近 100 条；`GET /api/v1/media/image` 受控代理（白名单 + Referer + LRU）。
2. **视频卡片默认过滤**：仅返回有非 deleted 监控目标或被商单引用的视频；`includeUnmonitored=1` 显示全部。
3. **动态目标命名**：新建 label = 正文/标题前 24 字；优先 `title_snapshot`；回填「label 恰好等于 UP 昵称」的旧目标。
4. **动态同步**：`GET/POST .../dynamics/sync`，最近 30 条 / 最多 2 页，TTL 6h。
5. **粉丝 metrics**：`all=1` 或 `limit` 上限 20000；响应带 `totalItems`。

## 不做

- 不改采集频率、不改图表前端、不动生产 `bili-wp002`。
