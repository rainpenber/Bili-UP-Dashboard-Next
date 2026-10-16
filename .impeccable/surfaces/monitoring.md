# Surface brief — 监控中心 (`/monitoring`)

**Mode:** Operate  
**Primary task:** 在已导入的数据里找到一条视频、UP 主或动态，看播放量和互动怎么变。

## 用户成功

- 切换视频 / UP 主 / 动态标签并完成筛选、分页。
- 选择列表项后在右侧（或窄屏下方）看到 ECharts 趋势。
- 加载失败可以再试；没有数据时有说明；还没点选时有引导。

## 信息层级

1. 页标题与任务描述（主）
2. 标签 + 筛选 + 列表（主）
3. 时序图表（次，依赖选择）
4. 「本地数据 · 不连 B 站」说明（tertiary，悬停可看数据服务是否正常）

## URL 状态

`tab`, `page`, `category`, `q`, `selected` — 可分享、可刷新恢复。

## 边界内容

- 长标题：`line-clamp` / `truncate`；动态 ID 允许 `break-all`。
- 还没点选：图表区用一句话引导，不展示假数据。

## 对照

DESIGN.md 令牌与禁止项；`/design-system` 组件状态。
