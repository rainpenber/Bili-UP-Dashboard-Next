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

本地实跑记录写在本文件末尾。容器 30 秒 `stop_grace_period` 由后续在实际镜像上验证，本包只把 Compose 配置成 30 秒。
