# AGENTS.md — 仓库智能体约束

## 产品边界

- 本仓库是**三人自媒体工作室**的运营中枢：商单制作、流程督导、B 站/账号监控的**确定性**层（存储、API、工作流规则、采集器、集成、UI）。
- **Hermes** 负责理解微信、Brief、PDF、网页、OneNote 等非结构化输入；本仓库**不得**实现基于关键词的通用语义解析器。
- 禁止提交生产密钥、真实聊天数据、生产端点或凭据；禁止调用微信/B 站生产 API。

## 技术栈（稳定）

| 层  | 栈                                |
| --- | --------------------------------- |
| Web | React + Vite + TypeScript         |
| API | Bun + Hono + TypeScript           |
| DB  | PostgreSQL（Docker Compose 本地） |
| CI  | GitHub Actions                    |

## Monorepo 布局

- `apps/web` — 前端
- `apps/api` — HTTP API
- `packages/contracts` — 共享契约（如 health）
- `packages/workflow` — 纯函数工作流规则

## 常用命令（在仓库根目录）

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run format      # Prettier 检查
bun run lint        # ESLint
```

本地 API：`cd apps/api && bun run dev`（默认端口 3000）  
本地 Web：`cd apps/web && bun run dev`（Vite 代理 `/api` → API）

PostgreSQL：`cp .env.example .env` 后 `docker compose up -d postgres`

## 安全规则

- 仅使用 `.env.example` 占位符；`.env` 不得入库。
- CI 不连接生产；当前单元测试**不需要** PostgreSQL 服务。
- 新集成必须可 mock，且默认关闭外网依赖。

## Definition of Done（工作包）

1. `bun run typecheck`、`bun run test`、`bun run build` 通过。
2. 无 TODO-only 实现、无伪造成功输出、无秘密/生产 URL。
3. 契约变更同步 `packages/contracts` 与消费方测试。
4. 行为变更更新 `docs/` 或对应 `work-packages/WP-*.md`。
