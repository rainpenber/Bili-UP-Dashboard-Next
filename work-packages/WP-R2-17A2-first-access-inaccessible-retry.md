# WP-R2-17A2：首次视频不可访问的有限重试与手动介入接口

## 决策

只给 BV、视频还没上线时：每 5 分钟重试一次，失败三次标记失败等待手动介入。保守计数（首次失败＝第 1 次，共 3 次）。成功进入正常 15/120/360 档。旧「15 分钟／2 小时」方案作废。

## 实现要点

- `planBilibiliFailure` + `first_access_retry`：仅 never-succeeded video + `not_found`；鉴权／风控／限频先于 not_found
- 复用 job `attempts`／`recordCollectorFailure`／唯一 bucket；第三次同事务 halt（清游标+disable）；有更新人工 pending 则跳过停用
- 读合同：`GET /api/v1/monitor/first-access-interventions`（当前轮：新 waiting pending 优先）
- manual-run 开新一轮；halt 后拒绝裸 `enabled=true`（409 `awaiting_manual_retry`）

## FIX1（集中纠正）

读接口当前轮、halt 后启停拒绝、分类顺序、fail+disable 同事务与并发跳过停用。

## 文档

- [first-access-inaccessible-retry.md](../docs/architecture/first-access-inaccessible-retry.md)
- [real-collector.md](../docs/architecture/real-collector.md) 错误表补充

## 验收

注入 transport + `runCollectorOnce` + 保留 PG（`REQUIRE_POSTGRES=1`，不 DROP）；可控时钟推进；HTTP 读 API 取人工事项；format／lint／typecheck／build／CI。
