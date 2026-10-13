# Bili-UP-Dashboard-Next / Studio Ops Hub

三人自媒体工作室的运营中枢基线：**商单制作**、**流程督导**、**B 站账号监控**（确定性层：存储、API、工作流、采集、UI）。非结构化理解由 **Hermes** 负责，不在本仓库实现。

## 架构摘要

| 组件   | 路径                 | 说明                                   |
| ------ | -------------------- | -------------------------------------- |
| Web    | `apps/web`           | React + Vite + TypeScript              |
| API    | `apps/api`           | Bun + Hono，`GET /health`              |
| 契约   | `packages/contracts` | 共享 Health JSON 类型与校验            |
| 工作流 | `packages/workflow`  | 纯函数规则（示例：商单阶段）           |
| 数据库 | Docker Compose       | PostgreSQL 16（开发用，WP-000 未接线） |

详见 [docs/architecture/system-overview.md](docs/architecture/system-overview.md)。

## 本地命令（精确）

在仓库根目录：

```bash
# 安装（与 CI 一致）
bun install

# 静态检查
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
```

开发服务：

```bash
# API — http://localhost:3000/health
cd apps/api && bun run dev

# Web — Vite 将 /api 代理到 API
cd apps/web && bun run dev
```

PostgreSQL（可选）：

```bash
cp .env.example .env
# 编辑 POSTGRES_USER、POSTGRES_PASSWORD、POSTGRES_DB
docker compose up -d postgres
```

## 文档

- [AGENTS.md](AGENTS.md) — 贡献与智能体约束
- [docs/runbooks/development.md](docs/runbooks/development.md) — 开发手册
- [work-packages/WP-000-bootstrap.md](work-packages/WP-000-bootstrap.md) — Bootstrap 合同

## 许可证

私有工作室内部项目（未指定 OSS 许可证）。
