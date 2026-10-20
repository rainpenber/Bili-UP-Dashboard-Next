# WP-R2-12A 日志容量与 Collector 退出

起点：`cursor/http-api-integration-490e` @ `b5a0c5c84c14b16be631959f5aa8511c61d743d2`。参考旧包 `ca8e65bdf71e638028f6825641fc758755fed1fd` 的日志与 Collector 模块，不合并该分支，不延续其 API 退出实现。本包只收紧日志持久化与 Collector 进程生命周期。API 退出协调留给 WP-R2-12B。

## 不变量

1. **有限容量，不转移藏匿**。等待队列、已拆批但尚未执行的批次、当前 in-flight 批次合计受硬上限约束。默认最多 1000 条，待持久化记录的序列化字节（含 in-flight）默认最多 4MiB。`LOG_QUEUE_MAX_RECORDS` 与 `LOG_QUEUE_MAX_BYTES` 只接受合理正整数；空值用默认。`0`、负数、小数、非数字、`Infinity` 和超出上限的值在进程启动时失败，不能变成无限。溢出时 FIFO 保留已有记录，拒绝最新入队。保留 20 条 / 250ms 批量、info 白名单、stdout、脱敏和 14 天保留。
2. **Collector 退出可区分**。正常结束、信号收尾、主循环 fatal 三条路径分开。fatal 原因脱敏后出现在 stdout（`process.loop_failed`），退出码不是 0，随后的 flush 不能把它改回 0。已领取任务在期限内完成，不再领取下一个。超时、尾事件未持久化、或停止事件在预算内仍放不进队列，都不能报完整成功。flush 默认 10 秒（`LOG_FLUSH_DEADLINE_MS`），总退出默认 20 秒（`PROCESS_EXIT_BUDGET_MS`）。Compose 的 `collector` `stop_grace_period` 为 30 秒。重复信号只收尾一次。
3. **证据离线且隔离**。新证据使用真 PostgreSQL、真实 Collector 入口和有界 sink。不访问 B 站或 CDN，不使用真实凭据，不连接共享历史库。缺 PostgreSQL 时失败关闭。验收库只关闭连接，不执行 DROP DATABASE。API 的 49 条路由行为保持原样；本包不把 API 退出当作通过项。

## 允许与禁止

允许：`packages/observability` 的容量、期限、关闭控制器、sink 失败结果、脱敏与保留测试；`apps/collector` 的进程入口、测试用 provider/sink 钩子和子进程回归；`docker-compose.yml` 里 app / collector 的日志容量变量，以及 collector 的 flush / 退出预算和 `stop_grace_period`；本规格、观测文档和 CI 的 fail-closed 步骤。

禁止：修改 `apps/api` 源文件、API 生命周期实现、UI、公开合同、迁移、采集调度、鉴权、签名、限频和元数据刷新算法。不新增队列服务。不部署、不合并。不声称 API 退出已经加固。

## 验收

- 慢、永不返回、抛错的 sink 下，待写加在途的条数和序列化字节始终不超过上限。覆盖单条超大 context、跨批、定时触发，以及 child logger 共享同一预算。观察峰值用 pending 统计，不只看 `queue.length`。
- 正常 flush 保持 FIFO 与批量且不重复。堵塞恢复后新日志可写。失败不抛给调用方，不泄密。
- 溢出、sink 错误、flush 超时同时检查 stdout 与数据库脱敏。测试只用虚构值。
- Collector 用产品入口 `apps/collector/src/index.ts` 拉起子进程，连接新建的隔离真库。SIGINT 尾批持久化；当前离线 job 完成且下一 job 仍为 pending；重复信号只有一条停止事件；当前任务永挂和 sink 永挂在期限内退出且退出码不是 0。
- 队列满时，停止事件在已接受批次写完后持久化；sink 永挂占满名额时退出码不是 0，且 `service.stopped` 没有入库。
- 主循环遇到 SQL 错误、且 `app_logs` 仍可写时，stdout 诊断原错误，退出码不是 0，`service.started` 与 `service.stopped` 各一条。
- `bun run format:check`、`lint`、`typecheck`、`test`、`build` 实际通过。

## 结果

`bun run format:check`、`lint`、`typecheck`、`test`、`build` 均通过。observability 22、collector 13、api 87，失败 0。API 清单与执行集合仍是 49。`apps/api` 源文件相对 `b5a0c5c` 无差异。验收库只关闭连接，没有 DROP DATABASE。

容量峰值来自同一次 suite，统计的是 queued + staged + in-flight，不是单独的 `queue.length`：

| 场景           | 峰值                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| 条数预算 50    | queued 10，staged 20，in-flight 20，pending 50，拒绝 10                   |
| 字节预算 64000 | queued 0，staged 35940，in-flight 11970，pending / 峰值 47910，拒绝 80212 |

子进程证据前缀 `WP-R2-12A-EVIDENCE`。下表是全量 suite 的记录；更早的同前缀库也保留。

| 场景                              | 保留库                   | 标识                                              | 结果                                                                                                                         |
| --------------------------------- | ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 脱敏 / 溢出 / 超时                | `wp_r2_12a_d16ec9e709f1` | `redact`、`redact-error`                          | 入库 2 条；拒绝 1；flush 超时 1；sink 失败 1；峰值 2 条                                                                      |
| Collector SIGINT 尾批             | `wp_r2_12a_5fe4b8834ac5` | `collector-ca7d1d9f-98af-43ad-9532-d6fe98238c67`  | heartbeat `idle`；滞后 1ms；退出码 0；`service.started`、`service.stopped`                                                   |
| Collector 当前任务 + 重复 SIGTERM | `wp_r2_12a_4e552ed8fd88` | `collector-cf956b7c-0eb7-4d08-92a1-d0651afc1823`  | 退出码 0；824ms；`BV1xx411c7mE` succeeded，`BV1xx411c7mD` pending；run `536243f2-6be5-499d-92df-dacb62877d80`；停止事件 1 条 |
| Collector 任务永挂                | `wp_r2_12a_6912d27f80f9` | `collector-903885b2-83f6-4800-bb94-8e74c933240d`  | 退出码 1；859ms；任务仍为 running                                                                                            |
| Collector sink 永挂               | `wp_r2_12a_70d6f19e8543` | `collector-3d7b27f8-71ca-490b-80dc-2f4e76eb4247`  | 退出码 1；409ms；heartbeat `idle`                                                                                            |
| 主循环 SQL 错误                   | `wp_r2_12a_751f77898917` | `fatal-loop-c757d2dd-5024-405d-80c3-a73318f3cbd4` | 退出码 1；诊断 `relation "collector_jobs" does not exist`；stderr 空；`app_logs` 仍有 started / stopped 各 1                 |
| 满预算后停止事件恢复              | `wp_r2_12a_0b1193492af0` | `collector-166b50cf-5bf3-4382-9af6-c1e48beba0fc`  | 退出码 0；834ms；重复 SIGINT；started 与 stopped 各 1                                                                        |
| 满预算且 sink 永挂                | `wp_r2_12a_717c5a04ead3` | `collector-c3fc8e8a-bff3-4ff2-9b64-b63803ee9aa8`  | 退出码 1；412ms；`stopEventAccepted` 为 false；入库 0 条                                                                     |

容器 30 秒 `stop_grace_period` 只写在 Compose 里，实际镜像未在本包验证。API 进程退出不在本包验收。
