# WP-004R 浏览器验收方案

## 状态：**PASS（待 CI 绿 — 第十一轮加强）**

CI job `verify`：`migrate`（含 `013` 主阻塞 pin 删除语义）→ 全量测试 → `bun run e2e`（`e2e/harness.ts` 对 `/api/v1` 5xx 与控制台 ZodError 零容忍）。

## 本地运行

```bash
cp .env.example .env
docker compose up -d postgres
bun run --filter @studio/db migrate
export E2E_BASE_URL=http://127.0.0.1:5173
bun run e2e
```

## 规格目录

| 文件                    | 覆盖                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `wp004-smoke.spec.ts`   | 首页、项目、模板设置、窄屏                                                                                 |
| `wp004-journey.spec.ts` | 串行节点、事项拆分、模板撤销、窄屏详情                                                                     |
| `wp004-round9.spec.ts`  | 合并、失败中文、模板 undo、发布表单、`#item-*`                                                             |
| `wp004-round10.spec.ts` | 模板发布隔离、promote/pin+API 绑定、发布 monitor jobs、深链、模板 redo/删除/窄屏、reset+undo               |
| `wp004-round11.spec.ts` | **视口** `#item-*` / `#node-*`、history API 200+「创建/关闭」、UI 非法连线中文错误、publish jobs、pin 绑定 |

## 后端（Postgres integration）

- `wp004r-round10.integration.test.ts`、`wp004r-round11.integration.test.ts`：Hermes/reset 竞态、history detail 对象、pin 删除、monitorJobTypes
- `audit-json.test.ts`：审计 detail 不双重 JSON 编码

## 说明

- Mock：`MONITOR_DATA_SOURCE=mock`
- 仅当 CI verify 全绿且无未捕获 5xx/ZodError 时维持 **PASS**；否则在此列出剩余项。
