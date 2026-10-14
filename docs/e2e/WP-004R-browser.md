# WP-004R 浏览器验收方案

## 状态：**部分完成（整体仍 FAIL）**

CI job `verify` 已启用 **真实 PostgreSQL + API + Web + Playwright**（见 `.github/workflows/ci.yml`：`migrate` → `bun run e2e` → `e2e:stack`）。本地需同样栈（见下文）。

## 本地运行

```bash
cp .env.example .env
docker compose up -d postgres
bun run --filter @studio/db migrate
export E2E_BASE_URL=http://127.0.0.1:5173
bun run e2e
```

## CI 已覆盖（真实行为断言）

规格目录：`e2e/specs/`

| 文件                    | 已覆盖                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `wp004-smoke.spec.ts`   | 首页、新建项目进详情、模板设置页加载、窄屏项目列表                                                                 |
| `wp004-journey.spec.ts` | 项目串行加节点 + 撤销；事项拆分；模板草稿新建节点 + Ctrl+Z 撤销；窄屏项目详情                                      |
| `wp004-round9.spec.ts`  | 事项合并；merge API 失败中文提示；模板撤销按钮禁用/启用；发布填表；`#item-*` 深链展开历史；阻塞→普通保存（API 层） |

## 剩余矩阵（未覆盖 — 不得宣称已完成）

- 模板 **发布** 后新旧项目 **模板版本隔离**（创建前后 workflow 节点集对比）
- **promote / pin** 完整 UI 路径与断言
- 发布后 **监控任务**、**结案闸门**（`overall_stage=closed`）端到端
- `#node-*` 深链聚焦节点属性面板
- 全面 **错误状态**（图连接非法、发布校验、模板校验失败等）
- 模板 **redo** 按钮与快捷键在 E2E 中的显式断言
- 跨模板 `reset_project_workflow` + undo 场景

## 说明

- Mock / 离线：`MONITOR_DATA_SOURCE=mock`，E2E 不调用 B 站/微信生产 API。
- 历史迁移与单元/integration 门禁见 `packages/db` / `apps/api` 测试，不在 Playwright 重复。
