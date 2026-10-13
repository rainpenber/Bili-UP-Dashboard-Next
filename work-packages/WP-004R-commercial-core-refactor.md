# WP-004R｜商单核心模型与页面重构

status: 开发中（Draft PR #5）

## 本迭代已落地

- 迁移 `004_commercial_core.sql`：替换旧 WP-004 线性/树形工作流为 DAG 模板与实例、待闭环事项、发布与监控契约、Hermes 提案表、审计日志。
- `@studio/contracts`：`commercial.ts`（项目、图、事项、首页、发布、Hermes 操作 Zod）。
- `@studio/workflow`：DAG 环检测、前置校验、发布后结案推导。
- API：`/api/v1/commercial/*`（首页、项目 CRUD、图、推进/回退、事项、发布幂等）。
- Web：首页三板块、项目列表、详情（概要/发布区/工作流 SVG）、监控文案「播放与互动趋势」。
- Fixtures：13 个确定性商单场景（`commercial-fixtures.ts`）+ 发布/监控契约样例。
- 迁移：004 legacy RENAME/INSERT SELECT 保留旧数据；008 审计 project_id 可空；009 事项取消原因。

## 待完成（相对工作包全文）

- Playwright E2E 浏览器验收套件；模板编辑器撤销/重做、新建模板节点；项目图节点属性表单（phase/optional/package）、拆分/合并/升级阻塞 UI；Hermes/undo/跨项目/发布隔离等集成测试补全；迁移升级测试在 CI Postgres 上必跑。
