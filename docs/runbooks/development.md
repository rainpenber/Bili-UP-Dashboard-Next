# 开发 Runbook

## 前置条件

- [Bun](https://bun.sh) 1.3.10（与 CI 一致）
- Docker（本地 PostgreSQL 与 Compose 可选）

## 首次克隆

```bash
git clone <repo-url>
cd Bili-UP-Dashboard-Next
bun install
cp .env.example .env
# 编辑 .env，设置 POSTGRES_*（勿提交 .env）
```

## 质量门禁

在仓库根目录：

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

## 本地运行

终端 1 — PostgreSQL（仅开发、需从宿主机连库时）：

默认 **部署** Compose **不会**把 PostgreSQL 映射到宿主机；API 在容器内通过 `postgres:5432` 访问。

若要在本机用 `migrate` / `psql`，显式加载 **仅开发** 的 override（绑定 `127.0.0.1`）：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev-postgres.example.yml up -d postgres
export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5432
```

终端 2 — 迁移与 Mock 导入：

```bash
bun run --filter @studio/db migrate
export MOCK_DATA_ROOT="$PWD/packages/monitoring/fixtures/mock-data"
curl -X POST http://localhost:3000/api/v1/imports/csv \
  -H 'content-type: application/json' \
  -d '{"mode":"apply","sourceTimezone":"Asia/Shanghai"}'
```

或使用 CLI（等价）：

```bash
bun packages/monitoring/src/cli.ts apply \
  --backend-root=packages/monitoring/fixtures/mock-data/backend \
  --frontend-root=packages/monitoring/fixtures/mock-data/frontend \
  --assets-root=packages/monitoring/fixtures/mock-data/assets \
  --source-timezone=Asia/Shanghai
```

终端 3 — API（`MONITOR_DATA_SOURCE=mock`）：

```bash
cd apps/api
MONITOR_DATA_SOURCE=mock bun run dev
```

终端 4 — Web：

```bash
cd apps/web
bun run dev
```

浏览器打开 Vite URL；监控中心通过 `/api/v1/monitor/*` 读取数据（不直接读 CSV）。

## Compose 与部署

- **生产稳态**：`docker-compose.yml` — `postgres` + `app` + `collector`（采集器不发布端口，只跑离线适配器）。详见 [deploy.md](./deploy.md)。
- **开发热重载**：`docker compose -p bili-test -f docker-compose.dev.yml`（可选，与生产分离）。
- **固定项目名**：生产 `bili-prod`，测试/开发 `bili-test`；不要为每个 WP 或验收创建新项目名。

Mock 数据目录约定（只读挂载 `/mock-data`）：`backend/`、`frontend/`、可选 `assets/`。在 `.env` 设置 `MOCK_DATA_ROOT`。

CSV 导入为**显式一次性命令**（无自动 `mock-import` 服务），见 [deploy.md §4](./deploy.md#4-显式-csv-导入一次性无常驻-import-容器)。

导入在**单连接事务**内使用 `pg_advisory_xact_lock`；101+101 规模 dry-run/apply 应在数分钟内完成。

旧 CSV 增量同步默认关闭。宿主先把快照原子发布到本地目录，再执行 `sync-legacy`。命令、检查点和冲突规则见 [旧 CSV 增量同步](../architecture/legacy-csv-sync.md)。

## 故障排查

| 现象                                     | 处理                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web 显示无法连接 API                     | 确认 `apps/api` 在 3000 端口运行                                                                                                                       |
| `MONITOR_DATA_SOURCE=collector` 启动失败 | 只接受 `mock` 或 `collector`。默认 `COLLECTOR_PROVIDER=offline` 不访问 B 站。`bilibili` 缺少 `COLLECTOR_SECRET_KEY` 会拒绝启动。未知采集源 fail closed |
| `docker compose` 报缺少变量              | 确保 `.env` 含 `POSTGRES_USER/PASSWORD/DB`                                                                                                             |
| `bun install --frozen-lockfile` 失败     | 勿手改 lockfile；在根目录 `bun install` 后提交 `bun.lock`                                                                                              |
