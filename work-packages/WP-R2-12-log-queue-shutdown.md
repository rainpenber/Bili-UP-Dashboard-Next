# WP-R2-12 日志队列容量与服务退出可靠性

起点：`cursor/http-api-integration-490e` @ `b5a0c5c84c14b16be631959f5aa8511c61d743d2`。本包只收紧日志持久化与进程退出边界。API 合同、路由、UI、迁移、采集调度与鉴权不变。

## 不变量

1. **有限容量，不转移藏匿**。保留 Pino + PostgreSQL 分层。等待队列、已拆批但尚未执行的批次、当前 in-flight 批次合计受硬上限约束。默认最多 1000 条，待持久化记录的序列化字节（含 in-flight）默认最多 4MiB。`LOG_QUEUE_MAX_RECORDS` 与 `LOG_QUEUE_MAX_BYTES` 只接受合理正整数；空值用默认。`0`、负数、小数、非数字、`Infinity` 和超出上限的值直接失败，不能变成无限。溢出时 FIFO 保留已有记录，拒绝最新入队。
2. **有限退出，顺序正确**。API 与 Collector 收到 SIGTERM / SIGINT 后停止接新工作，等当前任务在预算内收尾，再记 `service.stopped`，限时 flush，停 retention，关闭 SQL / HTTP。flush 默认 10 秒（`LOG_FLUSH_DEADLINE_MS`），总退出预算默认 20 秒（`PROCESS_EXIT_BUDGET_MS`）。Compose 的 `app` 与 `collector` `stop_grace_period` 为 30 秒。超时或 flush 失败不得挂死，也不得把丢失报成完整成功。重复信号不重复收尾。退出码 0 只表示当前任务已结束且本次 flush 已持久化。
3. **可观测、兼容与隐私**。保留 warn/error 与 info 白名单、20 条 / 250ms 批量、14 天保留、stdout 即时输出和现有脱敏。拒绝条数与字节、sink 失败、flush 超时进入 logger 只读统计，并用限频 stdout 事件汇总。丢弃通知只含计数和状态。队列满的诊断不再入同一队列。sink 恢复后新日志可写；不无限重试，不重复已成功批次。

## 允许与禁止

允许：`packages/observability` 的 logger / sink / 退出辅助与测试；`apps/api/src/index.ts`、`apps/collector/src/index.ts` 及其入口专用辅助和子进程测试；`docker-compose.yml` 里 app / collector 的 `stop_grace_period` 与日志容量、退出预算环境变量；本规格、观测文档和 CI 的 fail-closed 步骤。

禁止：UI、API 路由与合同、迁移、采集调度 / 鉴权 / 签名 / 限频、新日志表、外部队列。不访问 B 站或 CDN，不使用真实凭据。验收库只关闭连接，不执行 DROP DATABASE。ops/health 的 `x-request-id` 响应头缺口不在本包修复。

## 验收

- 慢、永不返回、抛错的 sink 下，待写加在途的条数和序列化字节始终不超过上限。覆盖单条超大 context、跨批、定时触发，以及 child logger 共享同一预算。
- 正常 flush 保持 FIFO 与批量且不重复。堵塞恢复后新日志可写。失败不抛给调用方，不泄密，不形成无限 Promise 链。
- 溢出、sink 错误、flush 超时同时检查 stdout 与数据库脱敏，涵盖 Cookie、Authorization、SESSDATA、bili_jct。测试只用虚构值。
- API 与 Collector 各用产品入口拉起子进程，连接新建的隔离真库。确认监听或 heartbeat 后，在小于 20 条且小于 250ms 的尾批窗口发送 SIGTERM 与 SIGINT。退出后按 instance 读取末尾事件，证明最后一条已持久化且没有重复。
- 注入当前任务延迟 / 永挂和 sink 延迟 / 永挂。断言停接新工作、当前任务收尾、重复信号幂等，以及 flush 期限和总退出期限真实生效。超时的退出码不是 0。
- 子进程 provider 明确 offline，并安装网络守卫。缺 PostgreSQL 时失败关闭，不静默跳过。
- `bun run format:check`、`lint`、`typecheck`、`test`、`build` 实际通过。CI 执行上述真库与子进程用例。
