# WP-003 — 监控体验收口与详情骨架

**Base:** `main` @ `4045e2ff7ca253cd43ccaaba8d679ab7b5d5c44e`

## 路由

- 列表：`/monitoring`（URL 状态 tab/page/selected）
- 详情：
  - `/monitoring/videos/:bvid`
  - `/monitoring/creators/:mid`
  - `/monitoring/dynamics/:id`

## 数据

- `video_metric_samples.comment_count` 可空列（迁移 `003_video_comment_count.sql`）；历史导入保持 NULL，不伪造 0。
- 可选 CSV 列 `评论数`（views 文件）在存在时导入，不影响既有标准 header 文件。

## 前端

- 中文紧凑数值 / 短时间格式；图表默认最近 30 天 dataZoom；粉丝轴 ±300；播放/在线双 Y 轴。
- ECharts 使用解析后的 CSS 颜色，避免 Canvas 下 `var(--chart-*)` 失效。
- 主题：浅/深/系统 + 五种 accent，localStorage 持久化，首屏 inline 脚本防闪烁；系统字体栈，无 Google Fonts。

## 验收

`bun install --frozen-lockfile` 与 `format:check|lint|typecheck|test|build` 全通过；浏览器验证列表→详情、直接 URL、hover、缩放、主题与窄屏。
