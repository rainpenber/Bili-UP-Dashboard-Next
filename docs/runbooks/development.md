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

终端 1 — PostgreSQL：

```bash
docker compose up -d postgres
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

## 真实历史目录（Compose）

在 `.env` 中设置只读宿主机路径：

- `MONITOR_BACKEND_DATA_ROOT` — 对应 Windows `D:\app\scripts\v2`
- `MONITOR_FRONTEND_DATA_ROOT` — 对应 `D:\app\video-data-gui\public\data`

然后 `docker compose up` 启动 postgres、api、web。导入仍通过 CLI 执行，禁止通过 API 传入任意服务器路径。

## 故障排查

| 现象                                     | 处理                                                      |
| ---------------------------------------- | --------------------------------------------------------- |
| Web 显示无法连接 API                     | 确认 `apps/api` 在 3000 端口运行                          |
| `MONITOR_DATA_SOURCE=collector` 启动失败 | 预期行为；WP-001 仅实现 mock                              |
| `docker compose` 报缺少变量              | 确保 `.env` 含 `POSTGRES_USER/PASSWORD/DB`                |
| `bun install --frozen-lockfile` 失败     | 勿手改 lockfile；在根目录 `bun install` 后提交 `bun.lock` |
