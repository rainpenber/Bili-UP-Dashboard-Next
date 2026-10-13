# Studio Ops Hub — 设计系统（M2.5）

**模式：Operate** · 桌面优先 · 浅色默认 · 高信息密度

## 视觉方向

- **克制的工作台美学**：浅灰蓝中性底、略冷的侧栏层；主色仅用于主操作、当前选中、焦点与语义状态（非全站粉化）。
- **字体**：Inter 单族；固定 rem 字号阶梯（1.125 比例）；数据使用 tabular numerals。
- **布局**：侧栏 + 顶栏 + 面包屑 + 页头；监控页为「列表 / 筛选 + 详情图表」层级，窄屏纵向堆叠，禁止横向溢出。
- **禁止**：嵌套卡片墙、等权指标卡片汤、渐变字、装饰玻璃/模糊、粗色侧边框、技术风等宽装扮、emoji 图标、页面加载编排动画。

## 令牌（CSS 变量）

定义于 `apps/web/src/index.css`：`--background`、`--foreground`、`--primary`、`--muted`、`--border`、`--destructive`、`--success`、`--warning`、`--info`、`--sidebar-*`、`--chart-1`…`--chart-5`、阴影与密度变量。

## 组件约定

- **入口**：仅通过 `apps/web/src/components/ui/*` 使用 Radix + Tailwind 原语。
- **业务组件**：`components/layout`、`components/states`、`features/*` 组合原语，不引入第二套基础组件库（MUI/Ant/Mantine/Chakra）。
- **状态**：default / hover / focus / active / disabled / loading / error / selected 必须可辨；加载用 Skeleton；空态与错误可行动（重试）。

## 动效

150–250ms 状态过渡；`prefers-reduced-motion` 降级；动效仅传达状态变化。

## 图表

ECharts 保留；系列色引用 `--chart-*` 语义色，网格与轴标签使用 `--muted-foreground`。

## 回归面

`/design-system` 展示令牌与组件状态；变更 UI 时对照该页与 `.impeccable/surfaces/monitoring.md`。
