# Surface brief — 监控中心 (`/monitoring`)

**Mode:** Operate  
**Primary task:** 在已导入的离线数据中定位实体并阅读指标时序。

## 用户成功

- 切换视频 / UP 主 / 动态标签并完成筛选、分页。
- 选择列表项后在右侧（或窄屏下方）看到 ECharts 趋势。
- API 失败时可重试；无数据时有说明；未选择实体时有引导。

## 信息层级

1. 页标题与任务描述（主）
2. 标签 + 筛选 + 列表（主）
3. 时序图表（次，依赖选择）
4. 「离线 CSV · 不访问 B 站」环境说明（ tertiary，Tooltip 展开 API 健康）

## URL 状态

`tab`, `page`, `category`, `q`, `selected` — 可分享、可刷新恢复。

## 边界内容

- 长标题：`line-clamp` / `truncate`；动态 ID 允许 `break-all`。
- 无选中：图表区文案引导，不展示假数据。

## 对照

DESIGN.md 令牌与禁止项；`/design-system` 组件状态。
