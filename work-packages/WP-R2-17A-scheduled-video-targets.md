# WP-R2-17A 未来发布视频监控：计划开始时间与待开始改期

## 边界

只覆盖既有视频监控目标的计划开始 / 待开始改期 / 到点调度，以及同一目标的 HTTP 读写合同。不是新调度系统，不是完整 MON-02。

起点是 `cursor/dynamic-target-execution-bd65` 的 `a13ccd64bddb1ac0fb347f0ce5f887688db45fd2`（PR #43，16C）。本包使用独立分支和独立 PR，不合并、不部署。18492 / PR #40 视图切换保持待验收，本包不碰。

## 实现

- `packages/db/migrations/013_monitor_target_start_at.sql`：`monitor_targets.start_at TIMESTAMPTZ` 可空；非视频必须为 NULL。旧迁移不改。
- `insertMonitorTarget` / `updateMonitorTarget` / `enqueueDueCollectorJobs` / `claimNextCollectorJob` / `requestCollectorRun`：未来阶段不入队、不领任务；改期与 pending job 同事务；resume 用 `max(now, startAt)`；手动 run 在未到点时 409。
- 合同与卡片摘要返回明确 `startAt`；操作记录增加 `monitor.target.reschedule`。
- 字段与未交付说明见 `docs/architecture/scheduled-video-monitoring.md`。

## 不变量

1. 有未来 `startAt` 的新视频目标保存意图，`nextRunAt` 不早于 `startAt`，未来阶段不生成可执行 job；到点由既有 enqueue 入队。无 `startAt` 仍立即入队。claim/enqueue 都挡未来目标；run 未到点拒绝且不能覆盖计划。重复创建不改计划、不恢复 paused。
2. 改期在事务内更新 target、`nextRunAt` 与全部相关 pending；running 或已有成功全量零副作用；与 claim 用一致的行锁顺序。
3. 读合同与 ops 能读回开始时间变更；非法 / 无时区 / 非视频 / 已开始拒绝可读；迁移幂等。

## 明确不做

17A2 未上线业务码与宽限重试；17B UI / 项目关联；Hermes 指南；商单 / 视图切换 / MON-01 / dynamic 卡片 / 评论工具 / UP 发现。不访问真实 B 站、共享库或生产。验收使用新建且保留的 `wp_r2_17a_*` 逻辑库，不 `DROP`。
