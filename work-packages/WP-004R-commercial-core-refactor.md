# WP-004R｜商单核心模型与页面重构

status: 第十一轮 PASS（Draft PR #5 — CI 38531524314 @ `451ed71`）

## 本迭代已落地

- 迁移 `004_commercial_core.sql`：替换旧 WP-004 线性/树形工作流为 DAG 模板与实例、待闭环事项、发布与监控契约、Hermes 提案表、审计日志。
- `@studio/contracts`：`commercial.ts`（项目、图、事项、首页、发布、Hermes 操作 Zod）。
- `@studio/workflow`：DAG 环检测、前置校验、发布后结案推导。
- API：`/api/v1/commercial/*`（首页、项目 CRUD、图、推进/回退、事项、发布幂等）。
- Web：首页三板块、项目列表、详情（概要/发布区/工作流 SVG）、监控文案「播放与互动趋势」。
- Fixtures：13 个确定性商单场景（`commercial-fixtures.ts`）+ 发布/监控契约样例。
- 迁移：004 legacy RENAME/INSERT SELECT 保留旧数据；008 审计 project_id 可空；009 事项取消原因。

## 第十一轮（相对 `e66ad8a`）

- Migration `013`：主阻塞 pin `RESTRICT` + `BEFORE DELETE` 仅清 `primary_block_pinned_item_id`；升级前清理跨项目脏 pin。
- Reset：先锁 `project_workflows` 再数 custom nodes；并发竞态集成测试。
- 事项 history：`auditJson()` 写 jsonb 对象；create/update/close/cancel 审计；history route 通过 Zod。
- 深链：`scrollTargetIntoView` + E2E boundingBox 视口断言。
- E2E harness：API 5xx / ZodError 失败；禁止 history 模糊 or 断言。

## 待产品签收

- Draft PR #5 合并策略与生产部署不在本工作包范围。
