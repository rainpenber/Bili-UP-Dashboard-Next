# WP-002 — M2.5 应用壳、设计系统、监控迁移与不可变打包

**Base:** `cursor/wp-001-offline-monitoring-mock-3b07` @ `1317f940ecf2b6bc595bc8fa68e0ecce9f211a1f`

## 交付

- React 19 + Vite + TS 应用壳与路由（中文占位页 + 监控 + 设计系统画廊）
- shadcn Open Code 原语 + Tailwind + Radix + Lucide
- TanStack Query + URL 状态监控迁移
- 生产 `docker-compose.yml`：`postgres` + 单 `app` 镜像（API+SPA 同进程）；`docker-compose.dev.yml` 热重载；固定项目名 `bili-prod` / `bili-test`；显式 `docker compose run --rm` 导入
- PRODUCT.md / DESIGN.md / `.impeccable/surfaces/monitoring.md`

## 非目标

- M3 业务、B 站在线采集、DB/API 契约变更
