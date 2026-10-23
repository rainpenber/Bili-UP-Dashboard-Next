# WP-R2-26B：26A 收尾 — 投稿同步入图 + 卡片外链

## 范围

- 修复 `docs/architecture/http-coverage.md` Prettier（`format:check`）。
- `GET/POST /api/v1/monitor/creators/:mid/uploads/sync`：拉取 UP 主投稿列表（最近 100 / 最多 3 页），写入 `videos` 元信息与 `creator_publish_events`（`source=bilibili`，不覆盖手动事件，不建监控目标）。TTL 6h，`force` 强制刷新。
- 创作者详情粉丝图：打开时后台同步；「同步投稿」按钮与状态文案；默认缩放覆盖发布事件日期。
- 视频 / 动态 / UP 主卡片（列表+网格）：B 站外链图标按钮（`aria-label="在 B 站打开"`，`stopPropagation`）。

## 不做

- 不改变采集频率；不自动创建视频监控目标；不部署生产。

## 验收要点

- CI：format / lint / typecheck / test / build 全绿。
- 同步第二次 `cached:true` 且无新上游请求；手动事件仍保留。
- 三张卡片外链合法 id 才渲染，不触发卡片选中/跳转。
