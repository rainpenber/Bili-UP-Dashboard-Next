# WP-004R 浏览器验收方案

## 状态：**未完成（FAIL）**

本轮已加入 Playwright 依赖与最小 smoke 规格（`e2e/`），但 **CI 尚未启动 Postgres + API + Web 的 E2E job**，也未覆盖用户要求的完整矩阵（模板 undo、事项拆分/合并、结案闸门、深链、窄屏等）。

## 本地运行（需真实栈）

```bash
cp .env.example .env
docker compose up -d postgres
cd apps/api && bun run dev &
cd apps/web && bun run dev &
export E2E_BASE_URL=http://127.0.0.1:5173
bun run e2e
```

若 API/DB 未就绪，`bun run e2e` 将 **非零退出**（预期 FAIL，直至 job 与用例补全）。

## 目标覆盖（待实现）

- 项目创建、图编辑/属性/连接/删除/undo/批量布局
- 事项全生命周期、升级节点、拆分/合并、主要阻塞置顶
- 模板新增/编辑/发布、模板 undo/redo、新旧项目隔离
- 发布监控任务、结案闸门、`#node-*` / `#item-*` 深链、窄屏与错误状态
