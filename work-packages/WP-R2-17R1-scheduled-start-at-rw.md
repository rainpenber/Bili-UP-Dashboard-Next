# WP-R2-17R1：计划开始时间与目标读写重建

## 目标

在已验收的 17R0 共同事务边界上，为视频监控目标增加 `start_at` 计划开始时间，以及同一目标的创建／列表／详情／改期读写合同。无 UI 控件、无项目发布状态、无上游探测、无 17A2 宽限语义。

## Base

`cursor/collector-transaction-foundation-2753` @ `247128704f08ae0a5798031fc91c172e733d81d7`（PR #45）。禁止 merge／cherry-pick 已关闭的 PR #44 实现；只移植已验证的输入／兼容合同与测试场景。

## 不变量

1. **未来不早跑、旧行为兼容**：`nextRunAt` 不早于 `startAt`；未来目标不制造立即可执行 job；enqueue／claim／manual／恢复在锁后验证最新 `startAt`；无 `startAt` 行为与既有视频 auto／UP／dynamic 不变。
2. **改期在共同事务边界内保留历史**：目标意图／`nextRunAt`／pending 安排一次事务；复用 17R0 收敛与唯一 bucket；不删除有 run 的 job；不用 2099 停放。
3. **完整读写与可审计**：create／list／detail／PATCH／卡片摘要明确 `startAt`；创建与改期操作证据含 before／after；省略／同值／拒绝不造成功变更。

## 改动范围

- `packages/db/migrations/013_monitor_target_start_at.sql`
- `packages/db/src/collector-target-tx.ts`（锁后目标映射带 `startAt`）
- `packages/db/src/monitor-targets.ts`（create／update／enqueue／claim／manual）
- `packages/db/src/monitor-cards.ts`
- `packages/contracts` 目标／卡片／ops 兼容字段与严格时区解析
- `apps/api` 既有目标／卡片／ops 读写与 `scheduled-video-targets.integration.test.ts`
- web 仅类型／fixture／ops 动作标签兼容
- `docs/architecture/scheduled-video-monitoring.md`、事务边界文档补充

## 明确不做

17A2 上游码／宽限、监控／项目页控件、Hermes 闭环、Compose／CI 拓扑、真实 B 站、MON-01、dynamic UI、18492 换版。

## FIX1（同 PR）

- 非 video 显式 `startAt: null` 为无操作（整包回写兼容）；仅非 null 拒绝。
- 创建审计始终带 `changes.startAt`（含 after=null）。
- 013 幂等用例实际重放 DDL 两次并保全已有 `start_at` 数据。
