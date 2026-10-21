# 视频监控计划开始时间

WP-R2-17R1。建立在 [采集目标／任务／运行的共同事务边界](./collector-target-transaction-boundary.md) 之上。

## 字段

| 字段                          | 含义                                         |
| ----------------------------- | -------------------------------------------- |
| `monitor_targets.start_at`    | 用户计划的首次采集意图（仅 video 可非 null） |
| `monitor_targets.next_run_at` | 调度游标；不得早于未来的 `start_at`          |

缺省／null 的 `start_at` 表示无计划、立即待采。用户意图不等于可变的 `next_run_at`。

## 写入合同

- **创建**：完整显式时区（`Z` 或 `±HH:MM`），严格真实日历；UTC 存储／输出。未来 video 只保存目标，`next_run_at = start_at`，不插入立即可执行 job；到点由既有 enqueue 创建。
- **改期（PATCH `startAt`）**：仅 `last_success_at` 为空且无 `running` job。省略＝不变；显式 `null`＝清除计划并立即待采。暂停时改期保持暂停；恢复遵守 `max(now, startAt)`。
- **拒绝**：非 video／非法日期／无时区 → 400；缺目标 → 404；已成功／running／未到点 manual → 409，全量零副作用。
- **重复创建**：不覆盖计划、不恢复 paused。

## 准入门（锁后）

enqueue／claim／manual／恢复均在取得目标行锁后读取最新 `startAt`：

- 未来计划：不 enqueue、不 claim、manual 返回 `before_start`（提示先改时间）。
- 改期后旧时间不可派发；提前只保留一个有效 pending 机会（17R0 收敛 + 唯一 bucket）。

## 历史保全

改期更新 pending 的 `scheduled_for`，不删除已有 `collector_runs` 引用的 job；失败未成功可改期并保全 failed run。视频上已有 import 样本不代表该新 target 已成功。
