# WP-004R2-8 节点排期与统一流程浮层

## 范围

在已有 `wf_nodes.planned_at` / `completed_at` 上闭合计划日期，不新增表、精度列或排程实体。概要时间卡改为下一次交付，并与阶段 tooltip 共用同一套记录浮层。

## 日期约定

用户录入的计划是 `YYYY-MM-DD` 日历日期，写入 `planned_at` 为 Asia/Shanghai 当天 00:00。读回后若上海时分秒都是 0，只展示月日，不把它显示成约定的 00:00。已有非零时刻仍展示时分，不带秒。纯日期是否逾期按上海日历日比较，当天不算逾期。

完成时间仍只由原状态动作写入。计划日期修改不改状态、不改 `completed_at`、不改连线，并沿用 `expectedUpdatedAt` 与审计。

## 接口

- 读：`GET /projects/:id/workflow` 的节点增加 `plannedAt`、`completedAt`（可空 ISO）。
- 写：`POST /projects/:id/nodes/:nodeId/plan`，体为 `{ expectedUpdatedAt, plannedAt }`，`plannedAt` 为 `YYYY-MM-DD` 或 `null`。
