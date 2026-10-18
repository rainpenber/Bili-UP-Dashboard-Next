# WP-004R2-7 — 已上线项目的播放与互动

数据库项目详情（`/projects/:id`，`LiveProjectWorkflow`）在概要和时间轴之后、节点图之前，展示该项目已记录主视频的只读监控数据。

## 显示条件

只看商单详情里的 `publish.published` 和 `publish.bvid`。未发布不挂载视频数据区，也不请求监控接口。已发布时先请求 `GET /api/v1/monitor/videos/:bvid`：

- 404（`not found`）表示这个 BV 不在监控库，显示「暂未接入监控」，不再请求指标。
- 视频存在后才请求 `GET /api/v1/monitor/videos/:bvid/metrics`。空列表表示已接入但无采样，不绘制曲线。
- 其他读取失败留在这一块里，带重试。时间轴、概要和节点图继续可用。

不使用 `project_monitor_contracts.linked_bvid` 或按标题猜测另一个视频。播放量与在线观看各自取 `viewCount` 和 `onlineViewers` / `onlineViewersRaw`。`null` 保持为空，不写成 0。评论没有历史数值时不补评论曲线。

## 布局

视频图复用 `MetricCharts`。新增可选 `layout="columns"`：桌面两列（左播放、右互动），窄屏一列。不传时仍是原来的上下堆叠，监控页不变。分享沿用视频样本里的「分享」，不是动态的「转发」。
