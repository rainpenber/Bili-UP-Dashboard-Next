# 首次采集不可访问：有限重试与人工介入

WP-R2-17A2。建立在 [真实数据采集](./real-collector.md) 与 [视频监控计划开始时间](./scheduled-video-monitoring.md) 之上。

## 范围

- **仅**从未成功的 video（`last_success_at IS NULL`）。
- **仅**上游确证不可访问：`not_found`（`-404` / HTTP 404）。文案写「上游确认暂不可访问」，不把网络／鉴权／风控／限频说成「未上线」。
- 已成功 video、UP、dynamic、以及 `-352`／`-412`／`-509`／`-101`／超时／5xx：维持原语义。

## 计数与调度

保守计数：claim 后 `attempts` 已含本轮，首次失败即第 1 次；总计 3 次失败（不是再重试 3 次＝4 次请求）。

间隔固定 5 分钟，复用同一 `collector_jobs` 行与 `recordCollectorFailure` 事务缝；不新建平行状态机。

第三次：job `failed`，`haltAutoSchedule` 清 `next_run_at`，`enabled=false`（目标级，不停账号）。无远未来停放，无自动 enqueue 重开。

## 人工介入

- 读：`GET /api/v1/monitor/first-access-interventions`
  - **当前轮**：按 job 时间取最新匹配行。若存在比终态更新的 pending（含 `[first_access_waiting]`），返回 `waiting_confirmation`；否则才返回 `awaiting_manual`。
  - `id`＝当轮 job id（幂等识别同一轮）；重复 GET 不造新事实。
- 写：既有 `POST /api/v1/monitor/targets/:id/run` 开启新一轮（保留前序 failed run）；可用 PATCH `startAt` 改期。
- **禁止**仅 `PATCH enabled=true`：返回 409 `awaiting_manual_retry`（「已达上限，请手动采集重试」），避免 enabled 却无 pending 的假活跃。

## 停用与并发

第三次失败时，在同一把目标锁事务内：标记 job `failed`、写 failed run、清 `next_run_at`、`enabled=false`。若锁下已存在更新的 pending/running（人工刚开的新轮），则**不停用**、不清游标，只落本 job 的失败证据。

### Hermes 示例

```http
GET /api/v1/monitor/first-access-interventions HTTP/1.1
```

```http
POST /api/v1/monitor/targets/{targetId}/run HTTP/1.1
```

以返回项的 `id`（job id）识别同一轮失败；重试后新 job 会有新 `id`。不注册 Webhook／聊天推送。

## 创建语义

创建目标本身是同步落库；首次上游确认仍异步。创建响应不得假称已确认视频可访问。待确认状态经上述读 API 暴露。
