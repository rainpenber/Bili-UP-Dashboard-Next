# 部署 Runbook（个人 Debian 家服 · 离线 Mock）

生产稳态：**三个 Compose 服务** — `postgres`、`app`（单 Bun 进程同时提供 `/api/*` 与 SPA）、`collector`（独立进程，只消费 `collector_jobs`，默认 `COLLECTOR_PROVIDER=offline`，不访问 B 站，不发布宿主机端口）。切到真实采集时见 `docs/architecture/real-collector.md`。商单域的 `monitor_jobs` 仍不执行。

**固定项目名（复用，勿按 WP/验收临时起名）：**

| 环境            | 命令前缀                                                |
| --------------- | ------------------------------------------------------- |
| 生产            | `docker compose -p bili-prod`                           |
| 开发/测试热重载 | `docker compose -p bili-test -f docker-compose.dev.yml` |

宿主机**不需要**安装 Bun、Node 或 PostgreSQL。

## 1. 准备

```bash
cp .env.example .env
# 编辑 POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
# 可选：MOCK_DATA_ROOT=/path/to/mock-data-tree
```

## 2. 构建并启动（生产）

```bash
docker compose -p bili-prod up -d --build
```

- PostgreSQL：**无**宿主机端口，数据在卷 `bili-prod_postgres_data`（Compose 项目名前缀 + `postgres_data`）。
- 应用：单端口 `${APP_PORT:-8080}` → 容器内 `3000`。
- 采集器：无宿主机端口。日志用 `docker compose -p bili-prod logs -f collector`。

只启动或停止采集器：

```bash
docker compose -p bili-prod up -d --build collector
docker compose -p bili-prod stop collector
docker compose -p bili-prod start collector
```

`collector` 收到 SIGTERM 后会写完当前任务再退出。

## 3. 健康检查

```bash
curl -sf "http://127.0.0.1:${APP_PORT:-8080}/api/health"
curl -sf "http://127.0.0.1:${APP_PORT:-8080}/health"
curl -sf -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:${APP_PORT:-8080}/monitoring"
```

最后一项应返回 `200`（SPA `index.html`）。

## 4. 显式 CSV 导入（一次性，无常驻 import 容器）

PostgreSQL 必须先运行。使用**同一 app 镜像**运行 CLI（`--rm` 结束后不残留容器）：

```bash
docker compose -p bili-prod run --rm app \
  bun packages/monitoring/src/cli.ts apply \
  --backend-root=/mock-data/backend \
  --frontend-root=/mock-data/frontend \
  --assets-root=/mock-data/assets \
  --source-timezone=Asia/Shanghai
```

等价 HTTP（需 `app` 服务已 `up`）：

```bash
docker compose -p bili-prod exec app bun -e \
  "fetch('http://127.0.0.1:3000/api/v1/imports/csv',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'apply',sourceTimezone:'Asia/Shanghai'})}).then(async r=>{if(!r.ok)throw new Error(await r.text());console.log(await r.text())})"
```

## 5. 停止 / 重启（保留数据库卷）

```bash
docker compose -p bili-prod stop
docker compose -p bili-prod start
docker compose -p bili-prod restart app
```

## 6. 升级（保留卷）

```bash
git pull
docker compose -p bili-prod up -d --build
```

仅重建 `app` 或 `collector` 时：

```bash
docker compose -p bili-prod up -d --build app
docker compose -p bili-prod up -d --build collector
```

## 7. 回滚

```bash
git checkout <previous-tag-or-sha>
docker compose -p bili-prod up -d --build
```

数据库 schema 由应用内迁移向前兼容；回滚代码前请确认迁移兼容性。`005_monitor_targets_collector` 只新增监控项、采集任务、运行记录和心跳表。回滚到没有 Collector 的版本时，先 `docker compose -p bili-prod stop collector`，已写入的视频/粉丝样本保留，商单表不变。不要手动删除这些表，除非明确要丢弃监控项。

## 8. 项目级 teardown（**保留** PostgreSQL 卷）

```bash
docker compose -p bili-prod down
```

## 9. 销毁数据（显式、不可逆）

```bash
docker compose -p bili-prod down -v
```

**禁止**在未明确要求时使用全局 `docker system prune` / 跨项目 volume 清理。

## 10. 备份 / 恢复边界

- **备份**：在项目卷仍挂载时导出，例如  
  `docker compose -p bili-prod exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql`
- **恢复**：在空库或维护窗口执行 `psql` / `pg_restore`；勿在 runbook 中提交真实备份文件。

## 11. Compose 配置校验

```bash
docker compose -p bili-prod config
```

## 12. 开发热重载（非生产）

```bash
docker compose -p bili-test -f docker-compose.dev.yml up -d
```

Vite `5173` + API `3000`；导入同样用 `docker compose -p bili-test ... run --rm api bun packages/monitoring/...`（服务名为 `api`）。

## 13. 2026-10-18 测试环境只读观察

脱敏运行时证据的基线是 `9d9370e0b2c0d3b5b5e6cb92f68d5416f48b641b`。当时 Compose 项目名 `bili-test` 上实际在跑的是服务 `app`（合并镜像），容器 `3000` 映射到宿主机 `18492`，PostgreSQL `5432` 未向宿主机发布。随后的只读环境允许名单确认该进程为 `MONITOR_DATA_SOURCE=mock`、`API_PORT=3000`、`WEB_STATIC_ROOT=/app/web-dist`、`MOCK_DATA_ROOT=/mock-data`，且 `/mock-data` 挂载 `RW=false`。这与本节第 12 条的热重载拆分不是同一拓扑，也不能据此推断生产项目 `bili-prod`。端口和路由对照见 [ui-backend-contract-audit.md](../architecture/ui-backend-contract-audit.md)。
