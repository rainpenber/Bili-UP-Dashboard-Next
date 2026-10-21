# 未来发布视频监控（计划开始时间）

WP-R2-17A。这一包只给既有视频监控目标补上**计划开始时间**（`start_at` / `startAt`）：创建、读取、改期，以及到点之前不入队、不领任务、不被手动 run 绕过。它不是新的调度系统，也不是完整 MON-02。

## 存储

`013_monitor_target_start_at.sql` 在 `monitor_targets` 上增加可空 `start_at TIMESTAMPTZ`。它保存用户意图，与可变的 `next_run_at`（调度游标）分开。不增加第二份监控表或队列表。约束要求非视频目标的 `start_at` 必须为 NULL。

- 缺省 / `null`：与旧行为相同，创建后立即待采。
- 未来 `startAt`：写入意图，`next_run_at` 不早于 `startAt`，创建时不插入可执行 pending job；到点由既有 `enqueueDueCollectorJobs` 入队。
- HTTP 输入必须是带明确时区的完整时间（`Z` 或 `±HH:MM`）；输出一律 UTC ISO。中国业务展示用 Asia/Shanghai，不依赖服务器或浏览器默认时区。
- `creator` / `dynamic` 传非 null `startAt` → 400，零副作用。

## 待开始改期

可改期条件：`last_success_at` 为空，且当前没有 `running` job。已有成功 → 可读 409。已失败但未成功、无 running → 仍可改期，失败历史保留。视频全库已有导入样本**不等于**本目标已开始，不能据此拒绝改期。

- PATCH 省略 `startAt`：不改计划。
- 显式 `null`：取消计划，按当前时间立即待采。
- 当前 / 过去时间：视为立即待采。
- 暂停状态下改期仍保持暂停，不会自动恢复。
- 目标、`next_run_at` 与全部相关 pending job 在同一事务内调整；running / 已完成历史与操作记录保留。

## 调度不变量

1. `enqueueDueCollectorJobs` 与 `claimNextCollectorJob` 都要求 `start_at IS NULL OR start_at <= now`，并继续要求 `enabled`、未删除、`scheduled_for`/`next_run_at` 已到。claim 对 job 与 target 行 `FOR UPDATE … SKIP LOCKED`，与改期的 target 行锁一致，避免读到旧 `startAt` 后提前执行。
2. 手动 `POST …/run` 在未来计划未到时返回 409，提示先修改开始时间，不能静默覆盖计划。
3. 恢复遵守 `max(now, startAt)`，不补历史。重复创建同一 `(type, externalId)` 不改已有计划、不恢复 paused。
4. 读 API 无网络调用。创建目标不触发 metadata / refresh。

## 读合同与审计

目标 create / list / detail / PATCH 响应与监控卡片里的 target 摘要都返回明确的 `startAt`（无计划为 `null`）。旧无字段 payload 解析为 `null`。成功的 create（带开始时间）与 reschedule 写入 `monitor.target.created` / `monitor.target.reschedule` 操作记录；省略不造事件，失败不造成功。

## 本包未交付

- **17A2**：未发布上游业务码、有限宽限重试、明确未上线响应；只给 BV 无时间的元数据兜底。不得凭记忆编业务码。
- **17B**：监控页与项目发布页 UI、项目记录幂等关联。
- Hermes 调用指南与隔离闭环。
- 不改项目 publish 业务状态；不改视频 auto 15/120/360、UP 240、dynamic 固定规则。
