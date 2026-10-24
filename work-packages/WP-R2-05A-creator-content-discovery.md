# WP-R2-05A：UP 主新内容发现＋粉丝趋势事件标记＋新视频 10 天密集采集

## 范围

- 迁移 `017_creator_content_discovery`：`creator_discovery_configs`、`creator_publish_events`、`video_dense_collect_plans`；`monitor_targets.type` 增加内部调度类型 `discovery`（固定 5 分钟，不经公开创建 API）。
- 发现轮询：启用配置的博主每 5 分钟最多一次；投稿列表 `GET /x/space/wbi/arc/search`（WBI）；空间动态 `GET /x/polymer/web-dynamic/v1/feed/space`。端点以 `reference/bilibili-api/space-arc-search.md` / `space-dynamic-feed.md`（固定 commit 摘录）为准。
- 新视频自动建监控：仅当勾选「同时监控他的新视频数据」；单轮最多 2 条，超出记 `suppressed_auto_create_total`；动态只登记事件，不自动建动态目标。
- 密集采集：创建时写入 `dense15_until` / `dense30_until`（5 天 / 10 天），调度 15→30→常规，不靠每轮重算日期。
- 读接口：`GET/PUT .../creators/:mid/discovery`、`GET .../creators/:mid/publish-events`；登记 `api-inventory.json`。
- 前端：粉丝折线图发布标记（独立 scatter，可聚合、可点击已监控视频）；设置对话框发现开关。

## 不做

- 不访问真实 B 站做 CI；不扩采未勾选博主；不改商单/来源接入；不推断粉丝因果。

## 验收要点

- offline/mock：首次水印、幂等、超 2 抑制、失败不写假事件、密集阶段切换、关闭停轮询。
- 网络守卫全程零真实 B 站请求。
- format / lint / typecheck / test / build 全绿。
