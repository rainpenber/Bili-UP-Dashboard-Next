# WP-R2-05 — 监控项添加与独立后台采集闭环（离线采集源）

## 状态

实现中的离线闭环：页面添加 BV / UID，API 写入 `monitor_targets` 与 `collector_jobs`，独立 Collector 消费任务并把样本幂等写入既有指标表。

## 范围

- 新迁移 `005_monitor_targets_collector.sql`：`monitor_targets`、`collector_jobs`、`collector_runs`、`collector_heartbeats`。
- 不修改商单 `monitor_jobs`，Collector 不消费它。
- Provider 只有 `offline` / `mock`。其他上游 fail closed。
- 样本冲突时 `ON CONFLICT DO NOTHING`，不覆盖历史点。
- Compose 增加 `collector`，不发布新的宿主机端口。镜像构建需要把 `apps/collector` 拷进现有 Dockerfile，否则容器里没有入口。

## 非目标

真实 B 站账号、Cookie、签名、二维码登录、历史回填、告警阈值、商单与监控关联图。

## 启动

见 [docs/runbooks/deploy.md](../docs/runbooks/deploy.md) 与 [docs/architecture/monitor-collector.md](../docs/architecture/monitor-collector.md)。
