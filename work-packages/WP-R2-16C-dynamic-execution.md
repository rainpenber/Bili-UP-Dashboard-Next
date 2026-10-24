# WP-R2-16C 单条动态监控：目标到采集结果的后台执行

## 边界

把一条已经指定的动态接进现有后台流水线：目标、任务、离线或注入的 B 站 provider、事务样本和运行结果、原有 HTTP 与日志。不开发动态卡片或详情管理 UI，也不实现置顶、排序、新动态发现或商单联动。

起点是 `cursor/dynamic-sample-storage-9e04` 的 `783da9aac7a2444de22933b0b31b02093b8a0502`（16B，PR #42）。16A 在其祖先 PR #41。本包使用独立分支和独立 PR，不合并、不部署。

## 实现

- `packages/db/migrations/012_dynamic_monitor_targets.sql`：目标类型增加 `dynamic`，外部 id 使用十进制字符串检查，动态只允许固定间隔。旧迁移不改。
- `commitBilibiliDynamic`：同一次事务提交运行、`writeDynamicSampleWithin`、任务成功和下一次计划。
- 合同、worker 和运维只读投影接受 `dynamic`。显式 `auto`、非法 id、非法频率在写库前返回 400。
- 离线 `collectDynamic` 给出确定性样本。真实分支只调用 16A 的 `fetchDynamic` 一次。
- 页面只补上共享类型带来的名称和链接，避免把动态标成 UP 主。没有新的动态控件。

字段和未完成的页面说明见 `docs/architecture/dynamic-target-execution.md`。

## 不变量

1. 动态 id 全程是字符串。同一 `(type, externalId)` 只有一个活动目标。重复创建不恢复暂停、不额外建任务。暂停不领新任务，进行中的任务可以收尾，恢复不补历史，删除不删样本和日志。视频与 UP 主的入口保持原样。
2. 样本绑定这次 run、账号、目标和 `scheduled_for` 桶。`0` 与 `null` 分开。同桶冲突不覆盖旧样本，`samples_written` 为 0。事务失败不留下半成功的运行或样本。已有动态列表、详情和指标能读到最新桶。
3. 风控、过期、404、网络和解析失败沿用原状态机。不循环重签，不把失败写成 0 样本。请求、任务日志和操作记录能从原 ops HTTP 读到，并绑在本轮 job 或 run 上。动态复用原来的账号请求预算。

## 明确不做

不改 MON-01 排序，不改网格布局、商单、图表或旧迁移。不访问真实 B 站、共享库或生产账号。验收库保留，不 `DROP`。后台采集可用，并不表示用户已经能在动态页面上管理监控。
