# WP-R2-17R0：采集目标／任务／运行的共同事务边界重建

## 目标

从 16C 干净基线（PR #43 / `a13ccd6`）重建 target → job → run／sample 的共同 DB 事务与父行锁协议。不继承 PR #44 的 013／startAt／2099 停放实现。

## 不变量

1. **统一事务与父行锁**：所有任务路径先锁目标再锁任务，再写 run／样本；考虑 FK KEY SHARE。
2. **每目标一个有效执行机会**：manual／enqueue／claim／恢复在锁后重读；收敛冗余 pending，不用遥远时间停放。
3. **历史保全与持续调度**：保留已有 failed run；主任务成功后下一周期可继续 enqueue／claim。

## 改动范围

- `packages/db/src/collector-target-tx.ts`（新）
- `packages/db/src/monitor-targets.ts`
- `packages/db/src/real-collector.ts`
- `packages/db/src/index.ts`
- `packages/db/src/collector-target-tx.integration.test.ts`（新，`REQUIRE_POSTGRES=1`）
- `docs/architecture/collector-target-transaction-boundary.md`
- 本文件

禁止：migrations、contracts 字段、API／web、Compose／CI 配置、真实上游、PR #44 cherry-pick。

## 验收

见集成测试与 CI：死锁屏障（三种 commit）、旧快照 enqueue、双 pending 收敛后下周期、并发 manual／claim、暂停收尾、format／lint／typecheck／build／相关回归。

## 下包

17R1 在本边界上重做 `startAt` 与目标读写；本包不启动该工作。
