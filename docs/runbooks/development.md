# 开发 Runbook

## 前置条件

- [Bun](https://bun.sh)（与 CI 一致）
- Docker（可选，仅需要 PostgreSQL 本地实例时）

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
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
```

## 本地运行

终端 1 — API：

```bash
cd apps/api
bun run dev
```

终端 2 — Web：

```bash
cd apps/web
bun run dev
```

浏览器打开 Vite 提示的 URL；健康卡片应显示 API `ok`（需 API 已启动）。

## PostgreSQL（可选）

```bash
docker compose up -d postgres
docker compose ps
```

WP-000 测试不依赖数据库；后续 WP 再接入连接串（`POSTGRES_*`）。

## 故障排查

| 现象                                 | 处理                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| Web 显示无法连接 API                 | 确认 `apps/api` 在 3000 端口运行                          |
| `docker compose` 报缺少变量          | 确保 `.env` 含 `POSTGRES_USER/PASSWORD/DB`                |
| `bun install --frozen-lockfile` 失败 | 勿手改 lockfile；在根目录 `bun install` 后提交 `bun.lock` |
