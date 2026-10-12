# WP-001 — B 站历史数据离线 Mock 垂直切片

## 状态

**已完成（PR #2）** — 离线 Mock 监控垂直切片：导入、API、Web、受控 assets、CI PostgreSQL。

## 合同摘要

### 已批准目标

在完全不访问真实 B 站接口、不使用任何 Cookie/WBI/Web Ticket/二维码登录的前提下，实现：

1. 历史 CSV 和静态图片资源的 inventory、dry-run、apply；
2. PostgreSQL 规范存储、来源追溯、幂等导入与报告；
3. Hono 查询 API；
4. React/Vite 监控中心：视频、UP 主、动态列表和时序图；
5. 可在 Debian Docker Compose 中用真实历史文件目录运行。

### 数据源硬开关

- `MONITOR_DATA_SOURCE=mock|collector`
- WP-001 只实现 `mock`；`collector` 启动时明确失败，禁止静默回退与 B 站网络请求。

### 数据语义（要点）

- 指标 CSV：`follower` / `views` / `detailcount`；`commentlist` 在 inventory 中标记 unsupported/deferred。
- UTF-8-SIG；历史时间按可配置 `SOURCE_TIMEZONE` 解释（默认 `Asia/Shanghai`）。
- `1000+` 解析为下界并保留 raw；不用 0 前向填充；重复时间戳保留并报告；同时间不同值进入 conflict。
- backend/frontend 镜像按 SHA-256 识别，规范数据一份、双来源 provenance。

### API 前缀

- `/api/v1/monitor/*`（列表分页、筛选、指标时序）
- `/api/v1/assets/:assetId`（受控静态资源，缺失时 SVG 占位）
- `/api/v1/imports/csv`（POST，dry-run/apply，仅扫描 `MOCK_DATA_ROOT`）
- `/api/v1/imports/:batchId`（GET 批次报告与 staging/conflict 统计）

### 验收

- 合成 fixture 覆盖 BOM、CRLF、quoted newline、`1000+`、0、重复时间、镜像、冲突、未知 header。
- `bun run format:check|lint|typecheck|test|build` 全通过；CI 含 PostgreSQL 集成测试；无 B 站请求守卫测试。

### 明确非目标

真实 B 站 API、Collector、生产部署、评论列表 UI、自动修复历史异常。
