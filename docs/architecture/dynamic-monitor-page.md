# 动态监控页面（16D）

WP-R2-16D。在 16C 后台闭环之上，给监控中心动态 tab 补上新增、启停、详情与最近采集记录。卡片 API 仍只服务视频/UP；动态走列表 JOIN 与 `GET /targets/of/:type/:externalId`。

## 解析

`parseMonitorExternalInput('dynamic', …)` 接受十进制 id（无前导零、非 `0`）或 `t.bilibili.com/<id>` 长链接。短链与视频/空间链接就地拒绝，不发网络请求。

## 目标读写

创建与启停仍是 `/api/v1/monitor/targets`。动态默认 `intervalMode=fixed`、`intervalMinutes=60`。列表与详情在 `dynamics` 上 LEFT JOIN 活动 `monitor_targets`，附带 `target` 摘要；详情页在实体缺失时用 identity 查找补齐启停条。

## 日志

展开区与详情工具条复用 ops `GET /api/v1/ops/collector-jobs?type=dynamic&externalId=…`（可选 `targetId`），不另做采集面板。
