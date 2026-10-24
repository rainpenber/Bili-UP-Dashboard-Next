# 采集目标／任务／运行的共同事务边界

WP-R2-17R0／17R1。本文件描述 DB 层共同并发协议。17R1 在同一锁序上增加 `start_at` 计划意图与锁后准入；不另建计划表／状态枚举／2099 停放。详见 [scheduled-video-monitoring.md](./scheduled-video-monitoring.md)。

## 范围

| 在内                                                                     | 在外                               |
| ------------------------------------------------------------------------ | ---------------------------------- |
| `monitor_targets`（含 `start_at`）/ jobs / runs / samples                | 上游未发布探测、宽限窗口、UI 控件  |
| enqueue / claim / manual / 改期 / success / failure / defer / 启停／软删 | 采集 transport、限流、重试预算算法 |
| 三种 `commitBilibili*` 成功提交                                          | 真实 B 站请求、Windows 采集、CSV   |

入口实现：`packages/db/src/collector-target-tx.ts`、`monitor-targets.ts`、`real-collector.ts`。

## 锁序协议（目标 → 任务 → 运行／样本）

1. 先 `SELECT … FROM monitor_targets WHERE id = $1 FOR UPDATE`。
2. 再锁该目标下需要变更的 `collector_jobs`（`FOR UPDATE`）。
3. 然后才 `INSERT collector_runs`、写样本、`UPDATE` 游标／状态。

外键在 `INSERT collector_runs` 时会对 `job_id` / `target_id` 取 **KEY SHARE**。若先插入 run 再去抢目标行锁，会与「持有目标 `FOR UPDATE` 再锁 job」的编辑路径形成 `40P01`。共同 seam `withMonitorTargetAndJobTransaction` 在插入 run 之前锁齐父行，消除该倒置。

多目标操作按 **uuid 字典序** 依次加锁（`lockMonitorTargetsInOrder`）。禁止一次事务锁住全部 due 目标做长批处理；`enqueueDueCollectorJobs` 对每个 due 目标单独开事务。

## Claim 与 SKIP LOCKED

Claim 使用真实 `FOR UPDATE OF j SKIP LOCKED` 选取 due pending，再对目标行 `FOR UPDATE NOWAIT`：

1. 若目标行锁被占用（例如他事务正在编辑该目标），**立即跳过**该 target，不进入 `Lock`/`transactionid` 等待；
2. 取得目标锁后收敛冗余 pending，再把本 job 标为 `running`；
3. 循环时维护本轮已跳过的 target 集合，并按 **本次 due 候选总数（+1）** 作为单次调用安全阀——结束于已领取或已无候选，而不是固定次数（旧的 64 会在前 64 长期持锁时饿死第 65 个）。

因此持有目标 A 的锁不得阻塞领取独立目标 B。成功提交路径仍是目标→任务，与 claim 的 job→(NOWAIT)目标配合：claim 从不在持有 job 锁时**等待**目标锁。

## Offline 成功提交

`runCollectorOnce` 的 offline 视频／UP 路径复用 `commitBilibiliVideo`／`commitBilibiliCreator`（同事务写 run+样本+收尾）。提交失败整事务回滚，不得留下无 run 来源的半成功样本。

成功提交之后的 `audit`／`markUsed` 属于辅助操作：失败只记日志，不得再走采集失败／把终态 job 打回 pending。

## 每目标一个有效执行机会

- **manual**（`requestCollectorRun`）：锁后若已有 pending/running，复用既有 job，不因 `now` 不同再插一条；若复用的是 pending，将其 `scheduled_for` 拉到 `now`（与基线「立即采集」一致），仍保持每目标至多一个有效机会。
- **enqueue**：锁后重读 `next_run_at` 与 `start_at`；旧快照在等待改期锁后不得插入过期／未到点 bucket。
- **resume**：遵守 `max(now, startAt)`；收敛后至多保留／创建一个 due pending。
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

- 上游未发布码分类与有限宽限（17A2）
- 监控／项目页改期控件（17B 已提供 UI 入口）与 Hermes 闭环（17C）
- runner 进程崩溃后的通用恢复引擎
- 网络层／账号熔断策略（仍在事务外）
