# WP-004R｜商单核心模型与页面重构

status: 开发中（Draft PR #5）

## 本迭代已落地

- 迁移 `004_commercial_core.sql`：替换旧 WP-004 线性/树形工作流为 DAG 模板与实例、待闭环事项、发布与监控契约、Hermes 提案表、审计日志。
- `@studio/contracts`：`commercial.ts`（项目、图、事项、首页、发布、Hermes 操作 Zod）。
- `@studio/workflow`：DAG 环检测、前置校验、发布后结案推导。
- API：`/api/v1/commercial/*`（首页、项目 CRUD、图、推进/回退、事项、发布幂等）。
- Web：首页三板块、项目列表、详情（概要/发布区/工作流 SVG）、监控文案「播放与互动趋势」。
- Fixtures：3 个代表性场景 + 发布/监控契约样例（完整 13 场景待补）。

## 待完成（相对工作包全文）

- 13 条真实感 fixtures 全覆盖、Hermes 高置信/低置信统一事务路径、图编辑（增删边/撤销重做/模板设置页）、列表三分组排序、发布表单 UI、事项完整 CRUD 与升级阻塞 UI、跨项目边/汇合校验 API 层拒绝。
