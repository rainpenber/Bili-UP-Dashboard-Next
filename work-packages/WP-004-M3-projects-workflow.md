# WP-004｜M3 商单项目与工作流垂直切片

状态：已实现（Cursor Cloud Agent）

## 交付摘要

- 迁移 `004_projects_workflow.sql`、`005_open_item_node_integrity.sql`：项目、团队成员、工作流模板/实例、未闭环事项（含节点归属约束）、Hermes 候选变更（accept 单事务 + 幂等创建）。
- API：`/api/v1/projects`、`/api/v1/dashboard/today`、`/api/v1/hermes/*`。
- 前端：今日驾驶舱、项目看板/列表、项目详情（概要 / 工作流 / 未闭环）。
- 规则包 `@studio/workflow`：节点跃迁、依赖重算、主阶段推导、驾驶舱排序。
- 固定 fixtures：`packages/db/src/project-fixtures.ts`（锚点时间 `FIXTURE_NOW_ISO`）。

## 本地

```bash
docker compose up -d postgres
cp .env.example .env
bun run --filter @studio/db migrate # 或 apps/api 启动时自动迁移
```

导入 fixtures（集成测试内自动执行；手动可在 PG 上调用 `seedProjectFixtures`）。
