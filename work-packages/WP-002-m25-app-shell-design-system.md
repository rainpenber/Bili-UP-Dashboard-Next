# WP-002 — M2.5 应用壳、设计系统、监控迁移与不可变打包

**Base:** `cursor/wp-001-offline-monitoring-mock-3b07` @ `1317f940ecf2b6bc595bc8fa68e0ecce9f211a1f`

## 交付

- React 19 + Vite + TS 应用壳与路由（中文占位页 + 监控 + 设计系统画廊）
- shadcn Open Code 原语 + Tailwind + Radix + Lucide
- TanStack Query + URL 状态监控迁移
- 生产 `docker-compose.yml` 多阶段镜像；`docker-compose.dev.yml` 开发挂载
- PRODUCT.md / DESIGN.md / `.impeccable/surfaces/monitoring.md`

## 非目标

- M3 业务、B 站在线采集、DB/API 契约变更
