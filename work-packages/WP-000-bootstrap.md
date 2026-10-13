# WP-000 — Repository Bootstrap

## 状态

**已完成（本 PR）** — 可执行 monorepo 基线。

## 合同

### 目标

为空仓库建立 Bun workspace monorepo，供后续工作包扩展；**不**实现业务功能。

### 交付物

1. `README.md` — 本地命令与架构摘要
2. `AGENTS.md` — 智能体不变量、命令、安全、DoD
3. `docs/product/requirements.md`
4. `docs/architecture/system-overview.md`
5. `docs/runbooks/development.md`
6. 本文件
7. `apps/web`、`apps/api`、`packages/contracts`、`packages/workflow`
8. 根脚本：format、lint、typecheck、test、build
9. `docker-compose.yml` + `.env.example`（无入库密码）
10. GitHub Actions CI（frozen lockfile；**不**启动 PostgreSQL，因当前测试无 DB 依赖）
11. 单元测试：health 契约、workflow 纯函数；Web build 验证

### 验收

- [x] 文档中的 `bun install` 与质量命令可执行
- [x] typecheck / test / build 通过
- [x] 无生产秘密、无微信/B 站网络调用、无 TODO-only 功能
- [x] 无部署、无 DB migration

### 明确排除

- Hermes、语义解析、生产集成、ORM/migration、E2E 对外网。

## 后续 WP 建议

- WP-001：API 连接 PostgreSQL + 健康深度检查
- WP-002：商单实体与 CRUD
- WP-003：Web 路由与布局壳
