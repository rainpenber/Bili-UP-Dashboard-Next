# 采集目标／任务／运行的共同事务边界

WP-R2-17R0。本文件只描述 DB 层共同并发协议，不引入 `startAt`、新迁移或新状态枚举。17R1 的计划开始时间读写应建立在本边界之上。

## 范围

| 在内 | 在外 |
| --- | --- |
| `monitor_targets` / `collector_jobs` / `collector_runs` / metric samples | 新字段、迁移、API、UI |
| enqueue / claim / manual run / success / failure / defer / 启停 / 软删除 | 采集 transport、限流、重试预算算法 |
| 三种 `commitBilibili*` 成功提交 | 真实 B 站请求、Windows 采集、CSV timer |

入口实现：`packages/db/src/collector-target-tx.ts`、`monitor-targets.ts`、`real-collector.ts`。

## 锁序协议（目标 → 任务 → 运行／样本）

1. 先 `SELECT … FROM monitor_targets WHERE id = $1 FOR UPDATE`。
2. 再锁该目标下需要变更的 `collector_jobs`（`FOR UPDATE`）。
3. 然后才 `INSERT collector_runs`、写样本、`UPDATE` 游标／状态。

外键在 `INSERT collector_runs` 时会对 `job_id` / `target_id` 取 **KEY SHARE**。若先插入 run 再去抢目标行锁，会与「持有目标 `FOR UPDATE` 再锁 job」的编辑路径形成 `40P01`。共同 seam `withMonitorTargetAndJobTransaction` 在插入 run 之前锁齐父行，消除该倒置。

多目标操作按 **uuid 字典序** 依次加锁（`lockMonitorTargetsInOrder`）。禁止一次事务锁住全部 due 目标做长批处理；`enqueueDueCollectorJobs` 对每个 due 目标单独开事务。

## Claim 与 SKIP LOCKED

字面 `FOR UPDATE OF j SKIP LOCKED` 会在持有 job 锁后再碰目标，与上述顺序冲突。Claim 改为：

1. 无锁 peek 一批 due pending；
2. 对每个候选：锁目标 → 收敛 → 条件 `UPDATE` 为 `running`；
3. 已被拿走或收敛掉的候选直接跳过。

跨 worker 仍不互相堵在对方的 job 行上；不同目标不共享行锁。

## 每目标一个有效执行机会

- **manual**（`requestCollectorRun`）：锁后若已有 pending/running，复用既有 job，不因 `now` 不同再插一条。
- **enqueue**：锁后重读 `next_run_at`；旧快照在等待改期锁后不得插入过期 bucket。
- **resume**：收敛后至多保留／创建一个 pending。
- **收敛**（`convergeActiveJobsUnderTargetLock`）：
  - 有 `running` 时保留 running，多余 pending 处理掉；
  - 无引用且从未执行的冗余 pending：**删除**；
  - 已有 `collector_runs` 引用的冗余 pending：置 `failed`，`error = '被新的任务安排取代，不再执行'`，**不**伪造新的失败 run／样本／上游错误；
  - 绝不把正在 `running` 的任务失败化；
  - **不用**遥远 `scheduled_for`（如 2099）充当取消。

## 历史保全与持续调度

- 可重试失败把 job 打回 pending 并保留 failed run；后续再安排不得 `DELETE` 断 FK。
- 主任务成功后推进 `next_run_at`；下一正常周期仍可 enqueue/claim。
- 拒绝／异常整事务回滚，不出现半更新的 target/job/run/sample。
- 暂停／软删除：拒领新任务（`enabled` / `deleted_at`），当前 `running` 允许收尾。
- 重复创建已存在的未删除身份：不恢复 paused，不补历史。

## 测试钩子

`CollectorTargetTxHooks.afterParentRowsLocked` 仅供集成测试插入受控屏障，生产调用方省略。不要把完整同步原语做成产品 API。

## 未覆盖（显式）

- `startAt` 计划开始与改期语义（17R1）
- runner 进程崩溃后的通用恢复引擎
- 网络层／账号熔断策略（仍在事务外）
