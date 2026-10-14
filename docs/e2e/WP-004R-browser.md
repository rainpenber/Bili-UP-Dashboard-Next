# WP-004R 浏览器验收方案

## 状态：**PASS（待 CI 绿）**

CI job `verify` 启用 **真实 PostgreSQL + API + Web + Playwright**（`.github/workflows/ci.yml`：`migrate` → `bun run e2e` → `e2e:stack`）。

## 本地运行

```bash
cp .env.example .env
docker compose up -d postgres
bun run --filter @studio/db migrate
export E2E_BASE_URL=http://127.0.0.1:5173
bun run e2e
```

## 规格目录：`e2e/specs/`

| 文件                    | 覆盖                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wp004-smoke.spec.ts`   | 首页、新建项目、模板设置、窄屏列表                                                                                                                                                    |
| `wp004-journey.spec.ts` | 串行加节点 + 撤销、事项拆分、模板 Ctrl+Z、窄屏详情                                                                                                                                    |
| `wp004-round9.spec.ts`  | 合并、失败中文提示、模板撤销、发布表单、`#item-*` 深链、阻塞→普通（API）                                                                                                              |
| `wp004-round10.spec.ts` | 模板发布 **新旧项目 templateNodeId 隔离**、promote/pin UI、发布→monitor/阶段、**#node-*** / 历史审计展开、模板 redo、窄屏无溢出、删除二次确认、非法边/API 错误、**跨版 reset + undo** |

## 后端矩阵（Postgres integration）

见 `apps/api/src/commercial.integration.test.ts`、`apps/api/src/wp004r-round10.integration.test.ts`：Hermes blocking→normal、节点状态历史、主阻塞复合 FK、reset 校验与 undo。

## 说明

- Mock / 离线：`MONITOR_DATA_SOURCE=mock`，E2E 不调用 B 站/微信生产 API。
- 若 CI 失败，以上 **PASS** 降级为 **FAIL** 并在此列出剩余项。
