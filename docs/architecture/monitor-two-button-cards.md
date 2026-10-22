# 监控卡片两键统一（16F）

WP-R2-16F。在 16E 视频网格精简之上，把分栏视频、UP 主（分栏+网格）、动态（分栏+网格）的卡片正面统一为「详情 + 主操作」。

## 视图与详情

| Tab | 分栏「详情」 | 网格「详情」 | 次要操作去向 |
| --- | --- | --- | --- |
| 视频 | 选中 → 右侧面板 | 跳 `/monitoring/videos/:id` | 面板 / 详情页 |
| UP 主 | 选中 → 右侧面板 | 跳 `/monitoring/creators/:id` | 面板 / 详情页 |
| 动态 | 跳 `/monitoring/dynamics/:id` | 同左 | 详情页（频率、失败、采集记录、日志） |

`view=grid` 对三个 tab 均生效；动态筛选栏提供与视频/UP 相同的布局切换。

## 组件

- `MonitorObjectCard` / `MonitorCardControls`：列表两键；视频网格委托 `VideoGridCard`；UP 网格委托 `CreatorGridCard`；`layout=detail` 供详情页与分栏右侧面板。
- `DynamicObjectCard` + `DynamicMonitorControls`：卡片仅两键；详情布局保留展开区与日志。
- `MonitorStateBadge`：共用状态徽标与失败红点。
