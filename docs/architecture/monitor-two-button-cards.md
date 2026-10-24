# 监控卡片动作（16F → 27C）

WP-R2-16F 起统一「主操作」；WP-R2-27C 将**视频**卡片进一步收成四项，并把次要操作只留在实体详情页。

## 视图与详情

| Tab   | 卡片正面                                      | 分栏右侧面板                        | 次要操作去向                             |
| ----- | --------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| 视频  | 徽标 + 主操作 + 查看详情 + 查看项目（有商单） | 同卡片口径（无设置/采集/移除/日志） | 视频详情页（含 AlertDialog 移除确认）    |
| UP 主 | 主操作 + 置顶 + B 站外链                      | 精简条 + 进详情                     | UP 详情页                                |
| 动态  | 主操作 + 置顶 + B 站外链                      | —（整卡进详情）                     | 动态详情页（频率、失败、采集记录、日志） |

视频卡片在线摘要取最近窗口**峰值**（「峰值在线」）；详情图表仍为逐点曲线。

## 组件

- `MonitorObjectCard` / `MonitorCardControls`：按 `surface`（card / panel / page）分流；视频网格委托 `VideoGridCard`；UP 网格委托 `CreatorGridCard`。
- `RemoveMonitorDialog`：移除二次确认。
- `peakOnlineFromSamples` / `formatVideoCardMetricsSummary`：卡片峰值在线。
- `DynamicObjectCard` + `DynamicMonitorControls`：保持两键；详情布局保留展开区与日志。
- `MonitorStateBadge`：共用状态徽标与失败红点。
